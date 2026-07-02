import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindUnique = vi.hoisted(() => vi.fn());
const mockUpsert = vi.hoisted(() => vi.fn());
const mockBetterUserFindUnique = vi.hoisted(() => vi.fn());
const mockMemberFindFirst = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  prisma: {
    orgTier: {
      findUnique: mockFindUnique,
      upsert: mockUpsert,
    },
    betterAuthUser: {
      findUnique: mockBetterUserFindUnique,
    },
    pluginMember: {
      findFirst: mockMemberFindFirst,
    },
  },
}));

import { getOrgTier, setOrgTier, resolveOrgIdByEmail, getEffectiveTier } from "./org-tier";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getOrgTier", () => {
  it("returns default free tier when no record exists", async () => {
    mockFindUnique.mockResolvedValue(null);

    const result = await getOrgTier("org-1");
    expect(result).toEqual({ tier: "free", status: "active", trialEndsAt: null });
  });

  it("returns stored tier when record exists", async () => {
    mockFindUnique.mockResolvedValue({
      id: "tier-1",
      organizationId: "org-1",
      tier: "pro",
      status: "active",
      trialEndsAt: null,
      updatedAt: new Date(),
      createdAt: new Date(),
    });

    const result = await getOrgTier("org-1");
    expect(result).toEqual({ tier: "pro", status: "active", trialEndsAt: null });
  });
});

describe("setOrgTier", () => {
  it("upserts tier data", async () => {
    mockUpsert.mockResolvedValue({});

    await setOrgTier("org-1", { tier: "pro", status: "active" });

    expect(mockUpsert).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      create: {
        organizationId: "org-1",
        tier: "pro",
        status: "active",
        trialEndsAt: null,
      },
      update: {
        tier: "pro",
        status: "active",
        trialEndsAt: null,
      },
    });
  });

  it("includes trialEndsAt when provided", async () => {
    mockUpsert.mockResolvedValue({});
    const trialDate = new Date("2025-12-31");

    await setOrgTier("org-1", { tier: "pro", status: "trialing", trialEndsAt: trialDate });

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ trialEndsAt: trialDate }),
      }),
    );
  });
});

describe("resolveOrgIdByEmail", () => {
  it("returns orgId when user and membership exist", async () => {
    mockBetterUserFindUnique.mockResolvedValue({ id: "user-1" });
    mockMemberFindFirst.mockResolvedValue({ organizationId: "org-1" });

    const result = await resolveOrgIdByEmail("user@test.com");
    expect(result).toBe("org-1");
  });

  it("returns null when user not found", async () => {
    mockBetterUserFindUnique.mockResolvedValue(null);

    const result = await resolveOrgIdByEmail("unknown@test.com");
    expect(result).toBeNull();
  });

  it("returns null when user has no membership", async () => {
    mockBetterUserFindUnique.mockResolvedValue({ id: "user-1" });
    mockMemberFindFirst.mockResolvedValue(null);

    const result = await resolveOrgIdByEmail("user@test.com");
    expect(result).toBeNull();
  });
});

describe("getEffectiveTier", () => {
  it("returns stored tier and status when active", async () => {
    mockFindUnique.mockResolvedValue({
      id: "tier-1",
      organizationId: "org-1",
      tier: "pro",
      status: "active",
      trialEndsAt: null,
      updatedAt: new Date(),
      createdAt: new Date(),
    });

    const result = await getEffectiveTier("org-1");
    expect(result).toEqual({ tier: "pro", status: "active" });
  });

  it("returns expired when trial has ended", async () => {
    const pastDate = new Date(Date.now() - 86400000);
    mockFindUnique.mockResolvedValue({
      id: "tier-1",
      organizationId: "org-1",
      tier: "pro",
      status: "trialing",
      trialEndsAt: pastDate,
      updatedAt: new Date(),
      createdAt: new Date(),
    });

    const result = await getEffectiveTier("org-1");
    expect(result).toEqual({ tier: "free", status: "expired" });
  });

  it("returns default free when no record exists", async () => {
    mockFindUnique.mockResolvedValue(null);

    const result = await getEffectiveTier("org-1");
    expect(result).toEqual({ tier: "free", status: "active" });
  });
});
