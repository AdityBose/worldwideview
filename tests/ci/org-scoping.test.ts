import { describe, it, expect, vi, beforeEach } from "vitest";

// Prevent db.ts from attempting real DB connection during module initialization
vi.stubEnv("DATABASE_URL", "");

const mockGetActiveOrgId = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ba-org", () => ({
    getActiveOrgId: mockGetActiveOrgId,
}));

import { applyTenantIsolation } from "@/lib/db";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCOPED_MODELS = [
    "favorite",
    "installedPlugin",
    "setting",
    "marketplaceCredential",
    "userApiKey",
] as const;

const NON_SCOPED_MODELS = [
    "user",
    "instance",
    "instanceMember",
    "account",
    "plan",
] as const;

const ALL_MODELS = [...SCOPED_MODELS, ...NON_SCOPED_MODELS] as const;

const QUERY_OPERATIONS = [
    "findMany",
    "findUnique",
    "findFirst",
    "update",
    "delete",
    "count",
] as const;

const MUTATION_OPERATIONS = [
    "create",
    "createMany",
    "updateMany",
    "deleteMany",
] as const;

const OPERATIONS = [...QUERY_OPERATIONS, ...MUTATION_OPERATIONS, "upsert"] as const;

// ---------------------------------------------------------------------------
// Mock Prisma client factory
// ---------------------------------------------------------------------------

interface MockSetup {
    client: Record<string, any>;
    modelFns: Record<string, Record<string, ReturnType<typeof vi.fn>>>;
}

function createMockClient(): MockSetup {
    const modelFns: Record<string, Record<string, ReturnType<typeof vi.fn>>> =
        {};

    const client: Record<string, any> = {};

    for (const model of ALL_MODELS) {
        modelFns[model] = {} as Record<
            string,
            ReturnType<typeof vi.fn>
        >;
        client[model] = {} as Record<string, any>;

        for (const op of OPERATIONS) {
            const fn = vi.fn().mockResolvedValue(op === "count" ? 0 : []);
            modelFns[model][op] = fn;
            client[model][op] = fn;
        }
    }

    client.$extends = vi.fn().mockImplementation(function (ext: any) {
        const handler = ext.query.$allModels.$allOperations;
        const wrapped: Record<string, any> = { ...client };

        for (const model of ALL_MODELS) {
            const pascalName =
                model.charAt(0).toUpperCase() + model.slice(1);
            wrapped[model] = {} as Record<string, any>;

            for (const op of OPERATIONS) {
                const originalFn = modelFns[model][op];
                wrapped[model][op] = async (args?: unknown) =>
                    handler({
                        model: pascalName,
                        operation: op,
                        args: args ?? {},
                        query: originalFn,
                    });
            }
        }

        return wrapped;
    });

    return { client, modelFns };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("org-scoped tenant isolation (CI enforcement)", () => {
    let mock: MockSetup;

    beforeEach(() => {
        vi.clearAllMocks();
        mock = createMockClient();
    });

    // ---- Scoped models: orgId injected ------------------------------------

    describe("scoped models", () => {
        it("injects orgId into WHERE on scoped model queries", async () => {
            mockGetActiveOrgId.mockResolvedValue("test-org-123");

            const extended = applyTenantIsolation(mock.client as any);
            await (extended as any).favorite.findMany({
                where: { someField: "val" },
            });

            expect(mock.modelFns.favorite.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        tenantId: "test-org-123",
                    }),
                }),
            );
        });

        it("injects orgId into create data on scoped models", async () => {
            mockGetActiveOrgId.mockResolvedValue("test-org-456");

            const extended = applyTenantIsolation(mock.client as any);
            await (extended as any).setting.create({
                data: { key: "theme", value: "dark" },
            });

            expect(mock.modelFns.setting.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        tenantId: "test-org-456",
                    }),
                }),
            );
        });

        it("preserves original where fields when injecting tenantId", async () => {
            mockGetActiveOrgId.mockResolvedValue("test-org-789");

            const extended = applyTenantIsolation(mock.client as any);
            await (extended as any).userApiKey.findMany({
                where: { name: "my-key" },
            });

            const args =
                mock.modelFns.userApiKey.findMany.mock.calls[0][0] as any;
            expect(args.where.tenantId).toBe("test-org-789");
            expect(args.where.name).toBe("my-key");
        });

        it("injects orgId into upsert create and update", async () => {
            mockGetActiveOrgId.mockResolvedValue("org-upsert");

            const extended = applyTenantIsolation(mock.client as any);
            await (extended as any).installedPlugin.upsert({
                where: { tenantId_pluginId: { tenantId: "old", pluginId: "p1" } },
                create: { pluginId: "p1", version: "1.0" },
                update: { version: "2.0" },
            });

            const args =
                mock.modelFns.installedPlugin.upsert.mock
                    .calls[0][0] as any;
            expect(args.create.tenantId).toBe("org-upsert");
            expect(args.update.tenantId).toBe("org-upsert");
        });
    });

    // ---- Non-scoped models: no injection ----------------------------------

    describe("non-scoped models", () => {
        it("does NOT inject tenantId on non-scoped model queries", async () => {
            mockGetActiveOrgId.mockResolvedValue("test-org-123");

            const extended = applyTenantIsolation(mock.client as any);
            await (extended as any).user.findMany({
                where: { email: "test@test.com" },
            });

            const args =
                mock.modelFns.user.findMany.mock.calls[0][0] as any;
            expect(args.where.tenantId).toBeUndefined();
        });
    });

    // ---- No org (local edition) -------------------------------------------

    describe("no org (local edition)", () => {
        it("does NOT inject tenantId when getActiveOrgId returns null", async () => {
            mockGetActiveOrgId.mockResolvedValue(null);

            const extended = applyTenantIsolation(mock.client as any);
            await (extended as any).favorite.findMany({
                where: { someField: "val" },
            });

            const args =
                mock.modelFns.favorite.findMany.mock.calls[0][0] as any;
            expect(args.where.tenantId).toBeUndefined();
            expect(args.where.someField).toBe("val");
        });

        it("passes through without injection when getActiveOrgId returns null (create)", async () => {
            mockGetActiveOrgId.mockResolvedValue(null);

            const extended = applyTenantIsolation(mock.client as any);
            await (extended as any).favorite.create({
                data: { entityId: "e1", pluginId: "p1", label: "L", pluginName: "P", userId: "u1" },
            });

            const args =
                mock.modelFns.favorite.create.mock.calls[0][0] as any;
            expect(args.data.tenantId).toBeUndefined();
        });
    });

    // ---- Non-request context (scripts, background jobs) -------------------

    describe("non-request context", () => {
        it("handles dynamic import failure gracefully (skips injection)", async () => {
            mockGetActiveOrgId.mockRejectedValue(
                new Error("not in request context"),
            );

            const extended = applyTenantIsolation(mock.client as any);
            await (extended as any).favorite.findMany({
                where: { someField: "val" },
            });

            const args =
                mock.modelFns.favorite.findMany.mock.calls[0][0] as any;
            expect(args.where.tenantId).toBeUndefined();
            expect(args.where.someField).toBe("val");
        });
    });
});
