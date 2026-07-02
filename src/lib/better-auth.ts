/**
 * Better Auth instance configuration.
 *
 * This is the auth SERVER instance — hosts the Better Auth runtime with
 * Prisma adapter.
 *
 * Key decisions:
 *  - cookiePrefix "better-auth" avoids collision with other auth cookies
 *  - trustedOrigins configurable via env vars with localhost fallbacks
 *  - basePath: "/api/ba" for the Better Auth API handler
 *  - All 5 plugins configured: organization, admin, jwt, oneTimeToken, apiKey
 */
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@/lib/db";
import { organization, admin, jwt } from "better-auth/plugins";
import { oneTimeToken } from "better-auth/plugins/one-time-token";
import { apiKey } from "@better-auth/api-key";
import { evaluatePasswordStrength, MIN_PASSWORD_SCORE } from "@/lib/password-strength";

export const auth = betterAuth({
    basePath: "/api/ba",
    database: prismaAdapter(prisma, {
        provider: "postgresql",
    }),
    emailAndPassword: {
        enabled: true,
        // Validate password strength at sign-up and password reset.
        // Rejects passwords scoring below MIN_PASSWORD_SCORE (2).
        passwordValidator: async (password: string) => {
            const { score, feedback } = evaluatePasswordStrength(password);
            if (score < MIN_PASSWORD_SCORE) {
                // Better Auth will surface this error to the client
                throw new Error(feedback);
            }
            // Return true to allow the password
            return true;
        },
    },
    user: {
        modelName: "betterAuthUser",
        additionalFields: {
            role: {
                type: "string",
                required: true,
                defaultValue: "user",
            },
        },
    },
    session: {
        modelName: "betterAuthSession",
    },
    account: {
        modelName: "betterAuthAccount",
    },
    verification: {
        modelName: "betterAuthVerification",
    },
    advanced: {
        cookiePrefix: "better-auth",
    },
    // Trusted origins: allow requests from all three apps in dev and prod.
    trustedOrigins: [
        process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
        process.env.NEXT_PUBLIC_WEB_APP_URL || "http://localhost:3001",
        process.env.NEXT_PUBLIC_MARKETPLACE_URL || "http://localhost:3002",
    ].filter(Boolean),
    // Phase 72: All five Better Auth plugins configured.
    // Bundled plugins (organization, admin, jwt, oneTimeToken) require no
    // additional npm packages. External plugin (apiKey) added in Task 2.
    // Stripe plugin removed per ADR-0009 — hub owns all billing.
    plugins: [
        // Multi-tenant organization scaffolding — single-user org for local,
        // full multi-tenant for cloud.
        organization({
            schema: {
                organization: { modelName: "pluginOrganization" },
                member: { modelName: "pluginMember" },
                invitation: { modelName: "pluginInvitation" },
            },
        }),
        // User management — list, ban, impersonate.
        admin(),
        // JWT + JWKS — token endpoint at /api/ba/token, JWKS at /api/ba/jwks.
        // The data engine fetches JWKS from this endpoint to verify plugin tickets.
        jwt({
            schema: { jwks: { modelName: "pluginJwks" } },
        }),
        // One-time tokens — replaces setup token flow from src/lib/auth/setupToken.ts.
        // Tokens expire after 1 hour by default.
        oneTimeToken({ expiresIn: 3600 }),
        // API Key management — replaces the HMAC bridge and manual API key
        // logic. Keys can be created, verified, listed, and revoked. Rate
        // limiting built-in.
        apiKey({
            schema: { apikey: { modelName: "pluginApiKey" } },
        }),
    ],
});
