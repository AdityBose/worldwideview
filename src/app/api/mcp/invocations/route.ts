/**
 * GET /api/mcp/invocations?sessionId=<uuid>
 *
 * Browser-facing endpoint for the plugin tool relay bridge (Phase 21 Wave 3 -- PLUG-03).
 * The browser bridge polls this endpoint to drain any pending tool invocations
 * that the MCP agent has queued for execution.
 *
 * Auth (dual-auth, mirrors GET /api/globe/commands):
 *   Primary:  NextAuth session cookie (browser path)
 *   Fallback: Bearer API key (programmatic path)
 *   userId comes ONLY from the resolved auth result -- never from the URL.
 *
 * sessionId scopes the invocation queue to a specific browser tab.
 * UUID format is validated before draining.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/ba-session";
import { authenticateApiKey } from "@/lib/apiKeyAuth";
import { drainToolInvocations } from "@/lib/mcpRelay";
import { mcpInvocationsLimiter, getClientIp } from "@/lib/rateLimiters";
import { isDemo } from "@/core/edition";
import { resolveUserTier, checkMcpInvocationsRateLimit } from "@/lib/mcpRateLimitConfig";

const SESSION_ID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(request: Request): Promise<NextResponse> {
    // Rate limit before any auth or DB work.
    const limited = mcpInvocationsLimiter.check(getClientIp(request));
    if (limited) return limited as NextResponse;

    if (isDemo) {
        return NextResponse.json({ error: "MCP is not available in demo mode" }, { status: 403 });
    }

    // Dual-auth: Better Auth session PRIMARY, Bearer API key FALLBACK.
    // userId is resolved exclusively from the auth result -- never from the URL.
    let userId: string | null = null;
    let keyId: string | null = null;

    const session = await getServerSession();
    if (session?.user?.id) {
        userId = session.user.id;
    } else {
        const apiKeyAuth = await authenticateApiKey(request);
        if (apiKeyAuth) {
            userId = apiKeyAuth.userId;
            keyId = apiKeyAuth.keyId;
        }
    }

    if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Per-key rate limit (Redis sliding window, tier-aware, SEC-02).
    // Complements the coarse IP gate above. Fails OPEN on Redis outage so
    // a broken Redis or tier DB query never blocks legitimate traffic.
    const rateLimitIdentity = keyId ? `key:${keyId}` : `user:${userId}`;
    const tier = await resolveUserTier(userId);
    const { allowed, retryAfterMs } = await checkMcpInvocationsRateLimit(rateLimitIdentity, tier);
    if (!allowed) {
        return NextResponse.json(
            { error: "Too many requests", retryAfterMs },
            { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } },
        );
    }

    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId") ?? "";

    if (!sessionId || !SESSION_ID_RE.test(sessionId)) {
        return NextResponse.json({ error: "invalid sessionId" }, { status: 400 });
    }

    const invocations = await drainToolInvocations(userId, sessionId);

    return NextResponse.json({ invocations });
}

export const runtime = "nodejs";
