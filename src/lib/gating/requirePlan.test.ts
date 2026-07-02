import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const mockGetActiveOrgId = vi.hoisted(() => vi.fn());
const mockGetEffectiveTier = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ba-org", () => ({
  getActiveOrgId: mockGetActiveOrgId,
}));

vi.mock("@/lib/org-tier", () => ({
  getEffectiveTier: mockGetEffectiveTier,
}));

import { requirePlan } from "./requirePlan";

beforeEach(() => {
  vi.clearAllMocks();
});

async function getStatus(response: NextResponse | null): Promise<number | null> {
  if (!response) return null;
  return response.status;
}

describe("requirePlan", () => {
  it("returns null when no org (local edition)", async () => {
    mockGetActiveOrgId.mockResolvedValue(null);

    const result = await requirePlan("pro");
    expect(result).toBeNull();
  });

  it("returns null when free meets free requirement", async () => {
    mockGetActiveOrgId.mockResolvedValue("org-1");
    mockGetEffectiveTier.mockResolvedValue({ tier: "free", status: "active" });

    const result = await requirePlan("free");
    expect(result).toBeNull();
  });

  it("blocks free user trying to access pro feature", async () => {
    mockGetActiveOrgId.mockResolvedValue("org-1");
    mockGetEffectiveTier.mockResolvedValue({ tier: "free", status: "active" });

    const result = await requirePlan("pro");
    expect(result).not.toBeNull();
    expect(await getStatus(result)).toBe(402);
    const body = await (result as NextResponse).json();
    expect(body).toMatchObject({ error: "Upgrade required", required: "pro", current: "free" });
  });

  it("allows pro user to access pro feature", async () => {
    mockGetActiveOrgId.mockResolvedValue("org-1");
    mockGetEffectiveTier.mockResolvedValue({ tier: "pro", status: "active" });

    const result = await requirePlan("pro");
    expect(result).toBeNull();
  });

  it("blocks suspended subscription", async () => {
    mockGetActiveOrgId.mockResolvedValue("org-1");
    mockGetEffectiveTier.mockResolvedValue({ tier: "pro", status: "suspended" });

    const result = await requirePlan("free");
    expect(result).not.toBeNull();
    expect(await getStatus(result)).toBe(402);
    const body = await (result as NextResponse).json();
    expect(body).toMatchObject({ error: "Subscription suspended" });
  });
});
