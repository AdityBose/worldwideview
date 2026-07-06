import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { prisma } from "@/lib/db";

vi.mock("@/lib/db", () => ({
    prisma: {
        workspace: {
            findUnique: vi.fn(),
        },
    },
}));

vi.mock("@/lib/cross-service/verify", () => ({
    verifyCrossServiceSignature: vi.fn().mockReturnValue({ valid: true }),
}));

function mockRequest(workspaceId: string): Request {
    return new Request(`http://localhost/api/instance/${workspaceId}/status`, {
        headers: {
            "X-Service-Signature": "t=1234567890,n=test-nonce,sig=valid",
            "X-Service-Timestamp": "1234567890",
            "X-Service-Nonce": "test-nonce",
        },
    });
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("GET /api/instance/[id]/status", () => {
    it("returns 401 without cross-service auth", async () => {
        const req = new Request("http://localhost/api/instance/ws-1/status");
        const res = await GET(req, { params: Promise.resolve({ id: "ws-1" }) });
        expect(res.status).toBe(401);
    });

    it("returns 404 when workspace not found", async () => {
        vi.mocked(prisma.workspace.findUnique).mockResolvedValue(null);

        const req = mockRequest("missing-ws");
        const res = await GET(req, { params: Promise.resolve({ id: "missing-ws" }) });
        const data = await res.json();

        expect(res.status).toBe(404);
        expect(data.error).toBe("Workspace not found");
    });

    it("returns setupCompleted: true when a member has emailVerified and password", async () => {
        vi.mocked(prisma.workspace.findUnique).mockResolvedValue({
            id: "ws-1",
            subdomain: "test-ws",
            members: [{ id: "mem-1" }],
        } as never);

        const req = mockRequest("ws-1");
        const res = await GET(req, { params: Promise.resolve({ id: "ws-1" }) });
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.id).toBe("ws-1");
        expect(data.subdomain).toBe("test-ws");
        expect(data.setupCompleted).toBe(true);
    });

    it("returns setupCompleted: false when no member has setup completed", async () => {
        vi.mocked(prisma.workspace.findUnique).mockResolvedValue({
            id: "ws-2",
            subdomain: "unset-ws",
            members: [],
        } as never);

        const req = mockRequest("ws-2");
        const res = await GET(req, { params: Promise.resolve({ id: "ws-2" }) });
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.id).toBe("ws-2");
        expect(data.subdomain).toBe("unset-ws");
        expect(data.setupCompleted).toBe(false);
    });

    it("queries with correct nested conditions (emailVerified + password)", async () => {
        vi.mocked(prisma.workspace.findUnique).mockResolvedValue({
            id: "ws-1",
            subdomain: "test-ws",
            members: [],
        } as never);

        const req = mockRequest("ws-1");
        await GET(req, { params: Promise.resolve({ id: "ws-1" }) });

        expect(prisma.workspace.findUnique).toHaveBeenCalledWith({
            where: { id: "ws-1" },
            select: expect.objectContaining({
                members: expect.objectContaining({
                    where: {
                        user: {
                            emailVerified: true,
                            accounts: {
                                some: {
                                    password: { not: null },
                                },
                            },
                        },
                    },
                }),
            }),
        });
    });
});
