import { NextRequest, NextResponse } from "next/server";
import { crossServiceAuth } from "@/lib/cross-service/middleware";
import { getActiveOrgId } from "@/lib/ba-org";
import { getOrgTier, getEffectiveTier, resolveOrgIdByEmail } from "@/lib/org-tier";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await crossServiceAuth(request);
  const isServiceAuth = !authError;

  if (!isServiceAuth) {
    const sessionOrgId = await getActiveOrgId();
    if (!sessionOrgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const { searchParams } = new URL(request.url);
  const orgIdParam = searchParams.get("organizationId");
  const emailParam = searchParams.get("email");

  let orgId: string | null = null;

  if (orgIdParam) {
    orgId = orgIdParam;
  } else if (emailParam) {
    orgId = await resolveOrgIdByEmail(emailParam);
    if (!orgId) {
      return NextResponse.json({ error: "Organization not found for email" }, { status: 404 });
    }
  } else {
    orgId = await getActiveOrgId();
  }

  if (!orgId) {
    return NextResponse.json({ error: "Unable to determine organization" }, { status: 400 });
  }

  const [tierData, effectiveTier] = await Promise.all([
    getOrgTier(orgId),
    getEffectiveTier(orgId),
  ]);

  return NextResponse.json({
    ...tierData,
    effectiveTier: effectiveTier.tier,
    effectiveStatus: effectiveTier.status,
  });
}
