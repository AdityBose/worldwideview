import { NextResponse } from "next/server";
import { crossServiceAuth } from "@/lib/cross-service/middleware";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
    const authError = await crossServiceAuth(request);
    if (authError) return authError;

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    if (!userId) {
        return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const memberships = await prisma.workspaceMember.findMany({
        where: { userId },
        include: {
            workspace: true,
        },
        orderBy: {
            joinedAt: "asc",
        },
    });

    const instances = memberships.map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        subdomain: m.workspace.subdomain,
        status: m.workspace.status,
        plan: m.workspace.plan,
        createdAt: m.workspace.createdAt,
        role: m.role,
    }));

    return NextResponse.json({ instances });
}

export async function POST(request: Request) {
    const rawBody = await request.clone().text();
    const authError = await crossServiceAuth(
        new Request(request.url, {
            method: request.method,
            headers: request.headers,
            body: rawBody,
        }),
    );
    if (authError) return authError;

    const body = JSON.parse(rawBody) as {
        subdomain?: string;
        name?: string;
        userId?: string;
        email?: string;
        tier?: string;
    };

    if (!body.subdomain) {
        return NextResponse.json({ error: "subdomain is required" }, { status: 400 });
    }
    if (!body.userId) {
        return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const subdomain = body.subdomain.toLowerCase().trim();

    if (!/^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/.test(subdomain)) {
        return NextResponse.json({ error: "Invalid subdomain format" }, { status: 400 });
    }

    const existing = await prisma.workspace.findUnique({
        where: { subdomain },
    });
    if (existing) {
        return NextResponse.json({ error: "Subdomain already taken" }, { status: 409 });
    }

    // Auto-create user if not found (hub has already verified)
    let user = await prisma.betterAuthUser.findUnique({ where: { id: body.userId } });
    if (!user && body.email) {
        user = await prisma.betterAuthUser.findUnique({ where: { email: body.email } });
    }
    if (!user && body.email) {
        user = await prisma.betterAuthUser.create({
            data: {
                id: body.userId,
                name: body.email.split("@")[0],
                email: body.email,
                emailVerified: true,
            },
        });
    }

    const workspace = await prisma.workspace.create({
        data: {
            name: body.name || subdomain,
            subdomain,
            ownerId: body.userId,
            status: "active",
            plan: "basic",
            tier: body.tier || "free",
            tierStampedAt: new Date(),
        },
    });

    await prisma.workspaceMember.create({
        data: {
            workspaceId: workspace.id,
            userId: body.userId,
            role: "owner",
        },
    });

    return NextResponse.json({
        id: workspace.id,
        name: workspace.name,
        subdomain: workspace.subdomain,
        status: workspace.status,
        plan: workspace.plan,
        tier: workspace.tier,
        createdAt: workspace.createdAt,
    });
}
