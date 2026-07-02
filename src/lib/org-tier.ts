import { prisma } from "@/lib/db";

export interface OrgTierData {
  tier: string;
  status: string;
  trialEndsAt: Date | null;
}

export interface TierInput {
  tier: string;
  status: string;
  trialEndsAt?: Date | null;
}

export async function getOrgTier(orgId: string): Promise<OrgTierData> {
  const record = await prisma.orgTier.findUnique({
    where: { organizationId: orgId },
  });

  if (!record) {
    return { tier: "free", status: "active", trialEndsAt: null };
  }

  return {
    tier: record.tier,
    status: record.status,
    trialEndsAt: record.trialEndsAt,
  };
}

export async function setOrgTier(orgId: string, data: TierInput): Promise<void> {
  await prisma.orgTier.upsert({
    where: { organizationId: orgId },
    create: {
      organizationId: orgId,
      tier: data.tier,
      status: data.status,
      trialEndsAt: data.trialEndsAt ?? null,
    },
    update: {
      tier: data.tier,
      status: data.status,
      trialEndsAt: data.trialEndsAt ?? null,
    },
  });
}

export async function resolveOrgIdByEmail(email: string): Promise<string | null> {
  const user = await prisma.betterAuthUser.findUnique({
    where: { email },
    select: { id: true },
  });

  if (!user) return null;

  const membership = await prisma.pluginMember.findFirst({
    where: { userId: user.id },
    select: { organizationId: true },
    orderBy: { createdAt: "asc" },
  });

  return membership?.organizationId ?? null;
}

export async function getEffectiveTier(orgId: string): Promise<{ tier: string; status: string }> {
  const { tier, status, trialEndsAt } = await getOrgTier(orgId);

  if (status === "trialing" && trialEndsAt && trialEndsAt < new Date()) {
    return { tier: "free", status: "expired" };
  }

  return { tier, status };
}
