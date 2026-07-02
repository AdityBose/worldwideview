import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

const mockDb = {
    setupToken: {
        create: vi.fn(),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
    },
};

vi.mock("@/lib/db", () => ({
    prisma: mockDb,
}));

const TOKEN_HEX_LENGTH = 64;

async function importModule() {
    return import("./setup-token");
}

describe("generateSetupToken", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("produces a 64-char hex raw token and stores SHA-256 hash", async () => {
        const mockRecord = {
            id: "uuid-1",
            tokenHash: "abc123",
            userId: "user-1",
            organizationId: null,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            usedAt: null,
            createdAt: new Date(),
        };
        mockDb.setupToken.create.mockResolvedValue(mockRecord);

        const { generateSetupToken } = await importModule();
        const result = await generateSetupToken("user-1");

        expect(result.rawToken).toHaveLength(TOKEN_HEX_LENGTH);
        expect(result.rawToken).toMatch(/^[0-9a-f]+$/);

        const expectedHash = crypto.createHash("sha256").update(result.rawToken, "utf8").digest("hex");
        expect(mockDb.setupToken.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tokenHash: expectedHash,
                userId: "user-1",
                organizationId: null,
            }),
        });
        expect(result.record).toBe(mockRecord);
    });

    it("accepts optional organizationId", async () => {
        const mockRecord = {
            id: "uuid-2",
            tokenHash: "def456",
            userId: "user-1",
            organizationId: "org-1",
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            usedAt: null,
            createdAt: new Date(),
        };
        mockDb.setupToken.create.mockResolvedValue(mockRecord);

        const { generateSetupToken } = await importModule();
        const result = await generateSetupToken("user-1", "org-1");

        expect(mockDb.setupToken.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                userId: "user-1",
                organizationId: "org-1",
            }),
        });
        expect(result.rawToken).toHaveLength(TOKEN_HEX_LENGTH);
    });

    it("sets expiry to 24 hours from now", async () => {
        const before = Date.now();
        mockDb.setupToken.create.mockResolvedValue({
            id: "uuid-3",
            tokenHash: "hash",
            userId: "user-1",
            organizationId: null,
            expiresAt: new Date(before + 24 * 60 * 60 * 1000),
            usedAt: null,
            createdAt: new Date(),
        });

        const { generateSetupToken } = await importModule();
        await generateSetupToken("user-1");

        const call = mockDb.setupToken.create.mock.calls[0][0];
        const expiresAt = call.data.expiresAt.getTime();
        const after = Date.now();

        expect(expiresAt).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000 - 1000);
        expect(expiresAt).toBeLessThanOrEqual(after + 24 * 60 * 60 * 1000 + 1000);
    });
});

describe("validateSetupToken", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns the record for a valid token", async () => {
        const rawToken = crypto.randomBytes(32).toString("hex");
        const tokenHash = crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");
        const futureExpiry = new Date(Date.now() + 60 * 60 * 1000);

        mockDb.setupToken.findUnique.mockResolvedValue({
            id: "uuid-1",
            tokenHash,
            userId: "user-1",
            organizationId: "org-1",
            expiresAt: futureExpiry,
            usedAt: null,
            createdAt: new Date(),
        });

        const { validateSetupToken } = await importModule();
        const result = await validateSetupToken(rawToken);

        expect(result).not.toBeNull();
        expect(result!.id).toBe("uuid-1");
        expect(result!.userId).toBe("user-1");
        expect(mockDb.setupToken.findUnique).toHaveBeenCalledWith({
            where: { tokenHash },
        });
    });

    it("returns null for an invalid token", async () => {
        mockDb.setupToken.findUnique.mockResolvedValue(null);

        const { validateSetupToken } = await importModule();
        const result = await validateSetupToken("nonexistent-token");

        expect(result).toBeNull();
    });

    it("returns null for a used token", async () => {
        const rawToken = crypto.randomBytes(32).toString("hex");
        const tokenHash = crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");

        mockDb.setupToken.findUnique.mockResolvedValue({
            id: "uuid-1",
            tokenHash,
            userId: "user-1",
            organizationId: null,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            usedAt: new Date(),
            createdAt: new Date(),
        });

        const { validateSetupToken } = await importModule();
        const result = await validateSetupToken(rawToken);

        expect(result).toBeNull();
    });

    it("returns null for an expired token", async () => {
        const rawToken = crypto.randomBytes(32).toString("hex");
        const tokenHash = crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");

        mockDb.setupToken.findUnique.mockResolvedValue({
            id: "uuid-1",
            tokenHash,
            userId: "user-1",
            organizationId: null,
            expiresAt: new Date(Date.now() - 60 * 60 * 1000),
            usedAt: null,
            createdAt: new Date(),
        });

        const { validateSetupToken } = await importModule();
        const result = await validateSetupToken(rawToken);

        expect(result).toBeNull();
    });
});

describe("consumeSetupToken", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("atomically consumes a valid token", async () => {
        const rawToken = crypto.randomBytes(32).toString("hex");
        const tokenHash = crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");
        const now = new Date();
        const consumedRecord = {
            id: "uuid-1",
            tokenHash,
            userId: "user-1",
            organizationId: null,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            usedAt: now,
            createdAt: new Date(),
        };

        mockDb.setupToken.updateMany.mockResolvedValue({ count: 1 });
        mockDb.setupToken.findUnique.mockResolvedValue(consumedRecord);

        const { consumeSetupToken } = await importModule();
        const result = await consumeSetupToken(rawToken);

        expect(result).not.toBeNull();
        expect(result!.id).toBe("uuid-1");
        expect(mockDb.setupToken.updateMany).toHaveBeenCalledWith({
            where: {
                tokenHash,
                usedAt: null,
                expiresAt: { gt: expect.any(Date) },
            },
            data: { usedAt: expect.any(Date) },
        });
    });

    it("returns null when consumed twice (second call)", async () => {
        const rawToken = crypto.randomBytes(32).toString("hex");

        mockDb.setupToken.updateMany.mockResolvedValue({ count: 0 });

        const { consumeSetupToken } = await importModule();
        const result = await consumeSetupToken(rawToken);

        expect(result).toBeNull();
    });

    it("returns null for an expired token", async () => {
        const rawToken = crypto.randomBytes(32).toString("hex");

        mockDb.setupToken.updateMany.mockResolvedValue({ count: 0 });

        const { consumeSetupToken } = await importModule();
        const result = await consumeSetupToken(rawToken);

        expect(result).toBeNull();
    });

    it("returns null for an invalid token", async () => {
        mockDb.setupToken.updateMany.mockResolvedValue({ count: 0 });

        const { consumeSetupToken } = await importModule();
        const result = await consumeSetupToken("nonexistent-token");

        expect(result).toBeNull();
    });
});
