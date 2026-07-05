import { NextResponse } from "next/server";
import { crossServiceAuth } from "@/lib/cross-service/middleware";
import { prisma } from "@/lib/db";

const TRIAL_DAYS = 30;

export async function POST(request: Request) {
    const rawBody = await request.clone().text();
    let body: { code?: string; userId?: string; email?: string };

    console.log("[access-code] request received", {
        bodySize: rawBody.length,
        hasCode: rawBody.includes('"code"'),
        hasUserId: rawBody.includes('"userId"'),
        hasEmail: rawBody.includes('"email"'),
    });

    try {
        const authRequest = new Request(request.url, {
            method: request.method,
            headers: request.headers,
            body: rawBody,
        });
        const authError = await crossServiceAuth(authRequest);
        if (authError) {
            console.warn("[access-code] cross-service auth rejected", {
                status: authError.status,
            });
            return authError;
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown auth error";
        console.error("[access-code] auth middleware threw", {
            error: message,
            stack: err instanceof Error ? err.stack : undefined,
        });
        return NextResponse.json(
            { error: "Authentication failed", details: message },
            { status: 500 },
        );
    }

    try {
        body = JSON.parse(rawBody) as { code?: string; userId?: string; email?: string };
    } catch {
        console.warn("[access-code] invalid JSON body", { rawBody });
        return NextResponse.json(
            { error: "Invalid JSON body", details: "Request body is not valid JSON" },
            { status: 400 },
        );
    }

    if (!body.code) {
        return NextResponse.json(
            { error: "Missing required field: code", details: "Access code is required" },
            { status: 400 },
        );
    }
    if (!body.userId) {
        return NextResponse.json(
            { error: "Missing required field: userId", details: "User ID is required" },
            { status: 400 },
        );
    }

    console.log("[access-code] validation passed", { userId: body.userId, codePrefix: body.code.slice(0, 4), hasEmail: !!body.email });

    let user = await prisma.betterAuthUser.findUnique({
        where: { id: body.userId },
        select: { id: true, email: true },
    });

    console.log("[access-code] lookup by id", { userId: body.userId, found: !!user });

    if (!user && body.email) {
        console.log("[access-code] lookup by email", { email: body.email });
        user = await prisma.betterAuthUser.findUnique({
            where: { email: body.email },
            select: { id: true, email: true },
        });
        console.log("[access-code] lookup by email result", { email: body.email, found: !!user });
    }

    if (!user && body.email) {
        console.log("[access-code] creating user", { email: body.email });
        user = await prisma.betterAuthUser.create({
            data: {
                email: body.email,
                name: body.email.split("@")[0],
            },
            select: { id: true, email: true },
        });
        console.log("[access-code] user created", { userId: user.id, email: user.email });
    }

    if (!user) {
        console.warn("[access-code] user not found or created", {
            userId: body.userId,
            email: body.email,
            reason: body.email ? "email lookup and creation failed" : "no email provided for fallback",
        });
        return NextResponse.json(
            {
                error: "User not found",
                details: body.email
                    ? `Could not find or create user with id ${body.userId} / email ${body.email}`
                    : `No user exists with id ${body.userId}`,
            },
            { status: 404 },
        );
    }

    const method = user.id === body.userId ? "id" : body.email === user.email ? "email" : "created";
    console.log("[access-code] user resolved", { userId: user.id, email: user.email, method });

    const membership = await prisma.pluginMember.findFirst({
        where: { userId: user.id },
        select: { organizationId: true },
        orderBy: { createdAt: "asc" },
    });
    if (!membership) {
        console.warn("[access-code] user has no organization", { userId: user.id, email: user.email });
        return NextResponse.json({
            error: "User has no organization. Create a workspace first.",
            success: false,
            details: `No pluginMember found for userId ${user.id}`,
        }, { status: 404 });
    }
    console.log("[access-code] user organization resolved", {
        userId: user.id,
        organizationId: membership.organizationId,
    });

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);

    try {
        const tier = await prisma.orgTier.upsert({
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
        console.log("[access-code] tier upserted", {
            organizationId: membership.organizationId,
            tier: tier.tier,
            status: tier.status,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("[access-code] tier upsert failed", {
            error: message,
            stack: err instanceof Error ? err.stack : undefined,
            organizationId: membership.organizationId,
        });
        return NextResponse.json(
            { error: "Failed to set organization tier", details: message },
            { status: 500 },
        );
    }

    console.log("[access-code] access code applied successfully", {
        userId: user.id,
        email: user.email,
        organizationId: membership.organizationId,
        tier: "pro",
        trialEndsAt: trialEndsAt.toISOString(),
    });

    return NextResponse.json({
        success: true,
        tier: "pro",
        status: "trialing",
        trialEndsAt: trialEndsAt.toISOString(),
    });
}
