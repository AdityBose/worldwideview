import { cache } from "react";
import { headers } from "next/headers";
import { auth } from "@/lib/better-auth";

/**
 * Resolve the active organization ID for the current request.
 *
 * Reads the active organization from Better Auth's organization plugin
 * (`session.session.activeOrganizationId`), falling back to the user's
 * oldest PluginMember membership if no active org is set on the session.
 *
 * Returns null when no organization membership exists or when called
 * outside a request context (scripts, migrations, background jobs).
 *
 * Uses React cache() so the result is computed once per request no
 * matter how many scoped queries run.
 *
 * Circular import note: ba-org.ts imports from @/lib/better-auth which
 * imports from @/lib/db. This is safe because db.ts only dynamically
 * imports ba-org.ts at query time (not module load time), so the
 * module graph resolves fully before any query runs.
 */
export const getActiveOrgId = cache(async (): Promise<string | null> => {
    try {
        const headersList = await headers();
        const session = await auth.api.getSession({
            headers: headersList,
        });

        // Prefer the active org from Better Auth's organization plugin
        const activeOrg = (session?.session as Record<string, unknown> | undefined)
            ?.activeOrganizationId;
        if (typeof activeOrg === "string") {
            return activeOrg;
        }

        // Fallback: query PluginMember for the user's oldest org membership
        if (session?.user?.id) {
            const { prisma } = await import("@/lib/db");
            const membership = await prisma.pluginMember.findFirst({
                where: { userId: session.user.id },
                select: { organizationId: true },
                orderBy: { createdAt: "asc" },
            });
            return membership?.organizationId ?? null;
        }

        return null;
    } catch {
        // Not in a request context (scripts, background jobs, SSR)
        return null;
    }
});
