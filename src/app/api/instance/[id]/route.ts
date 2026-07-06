import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { crossServiceAuth } from "@/lib/cross-service/middleware";

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const authError = await crossServiceAuth(request);
    if (authError) return authError;

    const { id } = await params;

    const workspace = await prisma.workspace.findUnique({ where: { id } });
    if (!workspace) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    await prisma.workspace.delete({
        where: { id },
    });

    return NextResponse.json({ success: true, id });
}
