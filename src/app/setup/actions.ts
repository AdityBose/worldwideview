"use server";

import { hashPassword } from "better-auth/crypto";
import { prisma } from "@/lib/db";
import { isDemo } from "@/core/edition";
import { evaluatePasswordStrength, MIN_PASSWORD_SCORE } from "@/lib/password-strength";
import { validateSetupToken, consumeSetupToken } from "@/lib/setup-token";

interface SetupResult {
    success: boolean;
    error?: string;
}

const DEMO_ADMIN_EMAIL = "admin@worldwideview.local";
const DEMO_ADMIN_NAME = "Demo Admin";

/**
 * Seed the demo admin account on first boot in demo edition.
 * Reads WWV_DEMO_ADMIN_SECRET from env and creates a Better Auth user
 * with email/password matching the demo admin credentials.
 * Idempotent: safe to call on every startup.
 */
export async function seedDemoAdminIfNeeded(): Promise<void> {
    if (!isDemo) return;
    const adminSecret = process.env.WWV_DEMO_ADMIN_SECRET?.trim();
    if (!adminSecret) return;

    const existing = await prisma.betterAuthUser.findUnique({
        where: { email: DEMO_ADMIN_EMAIL },
    });
    if (existing) return;

    const userId = crypto.randomUUID();
    const hashedPassword = await hashPassword(adminSecret);

    await prisma.$transaction([
        prisma.betterAuthUser.create({
            data: {
                id: userId,
                email: DEMO_ADMIN_EMAIL,
                name: DEMO_ADMIN_NAME,
                emailVerified: false,
                role: "demo-admin",
            },
        }),
        prisma.betterAuthAccount.create({
            data: {
                id: crypto.randomUUID(),
                accountId: DEMO_ADMIN_EMAIL,
                providerId: "credential",
                userId,
                password: hashedPassword,
            },
        }),
    ]);
}

/** Create the initial admin account. Rejects if any user already exists.
 *
 * Creates records in BOTH Better Auth tables (user + account) so the
 * admin can log in via Better Auth client SDK. The account uses the
 * "credential" providerId for email/password authentication.
 */
export async function createAdminAccount(formData: FormData): Promise<SetupResult> {
    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const confirm = formData.get("confirm") as string;

    if (!name || !email || !password) {
        return { success: false, error: "All fields are required." };
    }
    const strength = evaluatePasswordStrength(password);
    if (strength.score < MIN_PASSWORD_SCORE) {
        return { success: false, error: strength.feedback };
    }
    if (password.length < 8) {
        return { success: false, error: "Password must be at least 8 characters." };
    }
    if (password !== confirm) {
        return { success: false, error: "Passwords do not match." };
    }

    const existingCount = await prisma.betterAuthUser.count();
    if (existingCount > 0) {
        return { success: false, error: "Admin account already exists." };
    }

    const userId = crypto.randomUUID();
    const hashedPassword = await hashPassword(password);

    await prisma.$transaction([
        prisma.betterAuthUser.create({
            data: {
                id: userId,
                email,
                name,
                emailVerified: false,
                role: isDemo ? "demo-admin" : "user",
            },
        }),
        prisma.betterAuthAccount.create({
            data: {
                id: crypto.randomUUID(),
                accountId: email,
                providerId: "credential",
                userId: userId,
                password: hashedPassword,
            },
        }),
    ]);

    return { success: true };
}

/**
 * Validate a provision token and return the pre-filled user info.
 *
 * Returns valid=false if the token is missing, used, or expired.
 * Returns valid=true with the user's email and name when the token is valid.
 */
export async function validateProvisionToken(token: string): Promise<{
    valid: boolean;
    email?: string;
    name?: string;
    error?: string;
}> {
    const record = await validateSetupToken(token);
    if (!record) {
        return { valid: false, error: "Invalid or expired setup link." };
    }

    const user = await prisma.betterAuthUser.findUnique({
        where: { id: record.userId },
        select: { email: true, name: true },
    });
    if (!user) {
        return { valid: false, error: "Setup user not found." };
    }

    return { valid: true, email: user.email, name: user.name };
}

/**
 * Activate a provisioned cloud account by consuming the setup token and
 * setting the user's real password.
 *
 * Atomically consumes the setup token, updates the BetterAuthAccount with
 * the user's chosen password, and marks the user as emailVerified.
 *
 * After activation, the user must log in manually at /login (no auto-login).
 */
export async function activateProvisionedAccount(
    token: string,
    name: string,
    email: string,
    password: string,
): Promise<SetupResult> {
    if (!name || !email || !password) {
        return { success: false, error: "All fields are required." };
    }
    const strength = evaluatePasswordStrength(password);
    if (strength.score < MIN_PASSWORD_SCORE) {
        return { success: false, error: strength.feedback };
    }
    if (password.length < 8) {
        return { success: false, error: "Password must be at least 8 characters." };
    }

    const record = await consumeSetupToken(token);
    if (!record) {
        return { success: false, error: "Invalid or expired setup link." };
    }

    const hashedPassword = await hashPassword(password);

    const [, accountResult] = await prisma.$transaction([
        prisma.betterAuthUser.update({
            where: { id: record.userId },
            data: {
                name,
                email: email.trim().toLowerCase(),
                emailVerified: true,
            },
        }),
        prisma.betterAuthAccount.updateMany({
            where: {
                userId: record.userId,
                providerId: "credential",
            },
            data: { password: hashedPassword },
        }),
    ]);

    // Log diagnostic info
    console.log("[Setup] Account rows updated:", accountResult.count);

    // If no credential account existed (e.g., provision didn't create one),
    // create it now so login doesn't fail
    if (accountResult.count === 0) {
        await prisma.betterAuthAccount.create({
            data: {
                id: crypto.randomUUID(),
                accountId: email.trim().toLowerCase(),
                providerId: "credential",
                userId: record.userId,
                password: hashedPassword,
            },
        });
    }

    return { success: true };
}
