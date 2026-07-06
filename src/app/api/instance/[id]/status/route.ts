import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { crossServiceAuth } from "@/lib/cross-service/middleware";

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const authError = await crossServiceAuth(request);
    if (authError) return authError;

    const { id } = await params;

    const workspace = await prisma.workspace.findUnique({
        where: { id },
        select: {
            id: true,
            subdomain: true,
            members: {
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
                take: 1,
                select: { id: true },
            },
        },
    });

    if (!workspace) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    return NextResponse.json({
        id: workspace.id,
        subdomain: workspace.subdomain,
        setupCompleted: workspace.members.length > 0,
    });
}
