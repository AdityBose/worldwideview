import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { POST } from "./route";
import { prisma } from "@/lib/db";

vi.mock("@/lib/cross-service/middleware", () => ({
    crossServiceAuth: vi.fn(),
}));

import { crossServiceAuth } from "@/lib/cross-service/middleware";

vi.mock("@/lib/db", () => ({
    prisma: {
        betterAuthUser: { findUnique: vi.fn() },
        pluginMember: { findFirst: vi.fn() },
        orgTier: { upsert: vi.fn() },
    },
}));

function mockPostRequest(body: unknown): Request {
    return new Request("http://localhost/api/access-code", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Service-Signature": "t=1234567890,n=test-nonce,sig=valid",
            "X-Service-Timestamp": "1234567890",
            "X-Service-Nonce": "test-nonce",
        },
        body: JSON.stringify(body),
    });
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("POST /api/access-code", () => {
    it("returns 401 when cross-service auth fails", async () => {
        vi.mocked(crossServiceAuth).mockResolvedValue(
            NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        );

        const req = mockPostRequest({ code: "TEST1234", userId: "u1" });
        const res = await POST(req);
        expect(res.status).toBe(401);
    });

    it("returns 400 when code is missing", async () => {
        vi.mocked(crossServiceAuth).mockResolvedValue(undefined as never);

        const req = mockPostRequest({ userId: "u1" });
        const res = await POST(req);
        expect(res.status).toBe(400);
    });

    it("returns 400 when userId is missing", async () => {
        vi.mocked(crossServiceAuth).mockResolvedValue(undefined as never);

        const req = mockPostRequest({ code: "TEST1234" });
        const res = await POST(req);
        expect(res.status).toBe(400);
    });

    it("returns 404 when user is not found", async () => {
        vi.mocked(crossServiceAuth).mockResolvedValue(undefined as never);
        vi.mocked(prisma.betterAuthUser.findUnique).mockResolvedValue(null);

        const req = mockPostRequest({ code: "TEST1234", userId: "nonexistent" });
        const res = await POST(req);
        expect(res.status).toBe(404);
    });

    it("returns 404 when user has no org membership", async () => {
        vi.mocked(crossServiceAuth).mockResolvedValue(undefined as never);
        vi.mocked(prisma.betterAuthUser.findUnique).mockResolvedValue({
            id: "u1", name: "Test", email: "a@b.com",
        } as never);
        vi.mocked(prisma.pluginMember.findFirst).mockResolvedValue(null);

        const req = mockPostRequest({ code: "TEST1234", userId: "u1" });
        const res = await POST(req);
        expect(res.status).toBe(404);
    });

    it("sets org tier to pro/trialing for 30 days", async () => {
        vi.mocked(crossServiceAuth).mockResolvedValue(undefined as never);
        vi.mocked(prisma.betterAuthUser.findUnique).mockResolvedValue({
            id: "u1", name: "Test", email: "a@b.com",
        } as never);
        vi.mocked(prisma.pluginMember.findFirst).mockResolvedValue({
            organizationId: "org-1",
        } as never);
        vi.mocked(prisma.orgTier.upsert).mockResolvedValue({
            id: "tier-1", organizationId: "org-1", tier: "pro",
            status: "trialing", trialEndsAt: new Date("2026-08-03"),
            updatedAt: new Date(), createdAt: new Date(),
        } as never);

        const req = mockPostRequest({ code: "TEST1234", userId: "u1" });
        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.tier).toBe("pro");
        expect(data.status).toBe("trialing");
        expect(prisma.orgTier.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { organizationId: "org-1" },
            create: expect.objectContaining({
                organizationId: "org-1",
                tier: "pro",
                status: "trialing",
            }),
        }));
    });
});
