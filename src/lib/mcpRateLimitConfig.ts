/**
 * Tier-based rate limit configuration for the MCP invocations endpoint (PLUG-03).
 *
 * Each tier maps to a sliding-window budget. Budgets are configurable via
 * environment variables for self-hosted deployments:
 *   MCP_INVOCATIONS_FREE_MAX=100
 *   MCP_INVOCATIONS_BASIC_MAX=300
 *   MCP_INVOCATIONS_PRO_MAX=1200
 *   MCP_INVOCATIONS_WINDOW_MS=60000
 */

import { redisSlidingWindow } from "@/lib/geocodingRateLimit";

export interface RateLimitBudget {
    maxRequests: number;
    windowMs: number;
}

const DEFAULT_WINDOW_MS = Number(process.env.MCP_INVOCATIONS_WINDOW_MS) || 60_000;

const TIER_MAX: Record<string, number> = {
    free: Number(process.env.MCP_INVOCATIONS_FREE_MAX) || 100,
    basic: Number(process.env.MCP_INVOCATIONS_BASIC_MAX) || 300,
    pro: Number(process.env.MCP_INVOCATIONS_PRO_MAX) || 1200,
};

/**
 * Returns the effective rate limit budget for a given tier.
 * Unknown tiers fall back to "free" limits.
 */
export function getTierBudget(tier: string): RateLimitBudget {
    const maxRequests = TIER_MAX[tier.toLowerCase()] ?? TIER_MAX.free;
    return { maxRequests, windowMs: DEFAULT_WINDOW_MS };
}

/**
 * Resolve a user's org tier from their BetterAuth user ID.
 *
 * Queries PluginMember → OrgTier chain. Returns "free" on any failure
 * (no membership, no tier record, DB outage) so a broken rate limiter
 * never blocks legit traffic.
 */
export async function resolveUserTier(userId: string): Promise<string> {
    try {
        const { prisma } = await import("@/lib/db");
        const membership = await prisma.pluginMember.findFirst({
            where: { userId },
            select: { organizationId: true },
            orderBy: { createdAt: "asc" },
        });

        if (!membership) return "free";

        const tierRecord = await prisma.orgTier.findUnique({
            where: { organizationId: membership.organizationId },
        });

        return tierRecord?.tier ?? "free";
    } catch {
        return "free";
    }
}

/**
 * Checks the sliding-window rate limit for a given identity and tier.
 *
 * Keyed by `mcp:invocations:<identity>` so the invocations endpoint has
 * its own budget separate from the main MCP endpoint.
 *
 * @param identity  Redis key suffix, e.g. `key:<keyId>` or `user:<userId>`
 * @param tier      The user's effective tier ("free", "basic", "pro")
 * @returns         `{ allowed, retryAfterMs }` from redisSlidingWindow
 */
export async function checkMcpInvocationsRateLimit(
    identity: string,
    tier: string,
): Promise<{ allowed: boolean; retryAfterMs: number }> {
    const { maxRequests, windowMs } = getTierBudget(tier);
    return redisSlidingWindow(`mcp:invocations:${identity}`, maxRequests, windowMs);
}
