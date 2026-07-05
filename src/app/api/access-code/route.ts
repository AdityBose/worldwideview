import { NextResponse } from "next/server";
import { crossServiceAuth } from "@/lib/cross-service/middleware";
import { prisma } from "@/lib/db";

const TRIAL_DAYS = 30;

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

    let body: { code?: string; userId?: string; email?: string };
    try {
        body = JSON.parse(rawBody) as { code?: string; userId?: string; email?: string };
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (!body.code) {
        return NextResponse.json({ error: "code is required" }, { status: 400 });
    }
    if (!body.userId) {
        return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    let user = await prisma.betterAuthUser.findUnique({
        where: { id: body.userId },
        select: { id: true, email: true },
    });

    if (!user && body.email) {
        user = await prisma.betterAuthUser.findUnique({
            where: { email: body.email },
            select: { id: true, email: true },
        });
    }

    if (!user && body.email) {
        user = await prisma.betterAuthUser.create({
            data: {
                email: body.email,
                name: body.email.split("@")[0],
            },
            select: { id: true, email: true },
        });
    }

    if (!user) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const membership = await prisma.pluginMember.findFirst({
        where: { userId: user.id },
        select: { organizationId: true },
        orderBy: { createdAt: "asc" },
    });
    if (!membership) {
        return NextResponse.json({
            error: "User has no organization. Create a workspace first.",
            success: false,
        }, { status: 404 });
    }

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);

    await prisma.orgTier.upsert({
        where: { organizationId: membership.organizationId },
        create: {
            organizationId: membership.organizationId,
            tier: "pro",
            status: "trialing",
            trialEndsAt,
        },
        update: {
            tier: "pro",
            status: "trialing",
            trialEndsAt,
        },
    });

    return NextResponse.json({
        success: true,
        tier: "pro",
        status: "trialing",
        trialEndsAt: trialEndsAt.toISOString(),
    });
}
