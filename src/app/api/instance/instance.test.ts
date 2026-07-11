import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "./route";
import { prisma } from "@/lib/db";

vi.mock("@/lib/db", () => ({
    prisma: {
        workspaceMember: {
            findMany: vi.fn(),
            create: vi.fn(),
        },
        workspace: {
            findUnique: vi.fn(),
            create: vi.fn(),
        },
        betterAuthUser: {
            findUnique: vi.fn(),
            create: vi.fn(),
        },
        betterAuthAccount: {
            create: vi.fn(),
        },
        setupToken: {
            create: vi.fn(),
        },
    },
}));

vi.mock("@/lib/cross-service/verify", () => ({
    verifyCrossServiceSignature: vi.fn().mockReturnValue({ valid: true }),
}));

function mockServiceRequest(url: string): Request {
    return new Request(url, {
        headers: {
            "X-Service-Signature": "t=1234567890,n=test-nonce,sig=valid",
            "X-Service-Timestamp": "1234567890",
            "X-Service-Nonce": "test-nonce",
        },
    });
}

function mockPostRequest(body: unknown): Request {
    return new Request("http://localhost/api/instance", {
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

describe("GET /api/instance", () => {
    it("returns 401 without cross-service auth", async () => {
        const req = new Request("http://localhost/api/instance?userId=u1&email=a@b.com");
        const res = await GET(req);
        expect(res.status).toBe(401);
    });

    it("returns workspaces for a user", async () => {
        const mockMemberships = [
            {
                workspaceId: "ws-1",
                role: "owner",
                workspace: {
                    id: "ws-1",
                    name: "Test Workspace",
                    subdomain: "test-ws",
                    status: "active",
                    plan: "basic",
                    createdAt: new Date("2026-01-01"),
                },
            },
        ];
        vi.mocked(prisma.workspaceMember.findMany).mockResolvedValue(mockMemberships as never);

        const req = mockServiceRequest("http://localhost/api/instance?userId=u1&email=a@b.com");
        const res = await GET(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.instances).toHaveLength(1);
        expect(data.instances[0]).toMatchObject({
            id: "ws-1",
            name: "Test Workspace",
            subdomain: "test-ws",
            status: "active",
        });
    });

    it("returns empty instances array when user has no workspaces", async () => {
        vi.mocked(prisma.workspaceMember.findMany).mockResolvedValue([] as never);

        const req = mockServiceRequest("http://localhost/api/instance?userId=u1&email=a@b.com");
        const res = await GET(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.instances).toEqual([]);
    });

    it("returns 400 when userId is missing", async () => {
        const req = mockServiceRequest("http://localhost/api/instance?email=a@b.com");
        const res = await GET(req);
        expect(res.status).toBe(400);
    });
});

describe("POST /api/instance", () => {
    it("returns 401 without cross-service auth", async () => {
        const req = new Request("http://localhost/api/instance", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subdomain: "test", name: "Test", userId: "u1", email: "a@b.com" }),
        });
        const res = await POST(req);
        expect(res.status).toBe(401);
    });

    it("returns 400 when subdomain is missing", async () => {
        const req = mockPostRequest({ name: "Test", userId: "u1", email: "a@b.com" });
        const res = await POST(req);
        expect(res.status).toBe(400);
    });

    it("returns 400 when userId is missing", async () => {
        const req = mockPostRequest({ subdomain: "test", name: "Test", email: "a@b.com" });
        const res = await POST(req);
        expect(res.status).toBe(400);
    });

    it("returns 400 when subdomain format is invalid", async () => {
        const req = mockPostRequest({ subdomain: "ab", name: "Test", userId: "u1", email: "a@b.com" });
        const res = await POST(req);
        expect(res.status).toBe(400);
    });

    it("returns 409 when subdomain already exists", async () => {
        vi.mocked(prisma.workspace.findUnique).mockResolvedValue({
            id: "existing", name: "Existing", subdomain: "test", status: "active", plan: "basic",
            tier: "free", locked: false, lockedReason: null, lockedAt: null, tierStampedAt: null,
            ownerId: null, trialEndsAt: null, createdAt: new Date(), updatedAt: new Date(),
        } as never);

        const req = mockPostRequest({ subdomain: "test", name: "Test", userId: "u1", email: "a@b.com" });
        const res = await POST(req);
        expect(res.status).toBe(409);
    });

    it("creates workspace and workspace member with tier stamp", async () => {
        vi.mocked(prisma.workspace.findUnique).mockResolvedValue(null);
        vi.mocked(prisma.betterAuthUser.findUnique).mockResolvedValue({
            id: "u1", name: "a", email: "a@b.com", emailVerified: true,
        } as never);
        vi.mocked(prisma.workspace.create).mockResolvedValue({
            id: "new-ws", name: "Test Workspace", subdomain: "test-ws",
            status: "active", plan: "basic", tier: "pro", ownerId: "u1",
            locked: false, lockedReason: null, lockedAt: null, tierStampedAt: new Date(),
            trialEndsAt: null, createdAt: new Date(), updatedAt: new Date(),
        } as never);

        const req = mockPostRequest({
            subdomain: "test-ws", name: "Test Workspace",
            userId: "u1", email: "a@b.com", tier: "pro",
        });
        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.id).toBe("new-ws");
        expect(data.subdomain).toBe("test-ws");
        expect(data.tier).toBe("pro");
        expect(prisma.betterAuthUser.findUnique).toHaveBeenCalledWith({ where: { id: "u1" } });
        expect(prisma.workspace.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                subdomain: "test-ws",
                name: "Test Workspace",
                ownerId: "u1",
                tier: "pro",
            }),
        }));
        expect(prisma.workspaceMember.create).toHaveBeenCalled();
    });

    it("auto-creates user when not found", async () => {
        vi.mocked(prisma.workspace.findUnique).mockResolvedValue(null);
        vi.mocked(prisma.betterAuthUser.findUnique).mockResolvedValue(null);
        vi.mocked(prisma.betterAuthUser.create).mockResolvedValue({
            id: "u1-new", name: "a", email: "a@b.com", emailVerified: true,
        } as never);
        vi.mocked(prisma.workspace.create).mockResolvedValue({
            id: "new-ws", name: "Test", subdomain: "test-ws",
            status: "active", plan: "basic", tier: "free", ownerId: "u1",
            locked: false, lockedReason: null, lockedAt: null, tierStampedAt: new Date(),
            trialEndsAt: null, createdAt: new Date(), updatedAt: new Date(),
        } as never);

        const req = mockPostRequest({
            subdomain: "test-ws", name: "Test",
            userId: "u1-new", email: "a@b.com",
        });
        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(prisma.betterAuthUser.create).toHaveBeenCalledWith({
            data: {
                id: "u1-new",
                name: "a",
                email: "a@b.com",
                emailVerified: true,
            },
        });
        expect(prisma.betterAuthAccount.create).toHaveBeenCalledOnce();
        expect(data.tier).toBe("free");
    });
});
