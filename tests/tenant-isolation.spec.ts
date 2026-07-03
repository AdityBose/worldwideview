import { test, expect } from '@playwright/test';
import { PrismaClient } from '../src/generated/prisma/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import crypto from 'node:crypto';

const TEST_USER_EMAIL = 'playwright-test@worldwideview.local';

test.describe('Multi-Tenant Data Isolation', () => {
  test.describe.configure({ mode: 'serial' });

  let prisma: PrismaClient;
  let pool: Pool;
  let userId: string;
  let orgAId: string;
  let orgBId: string;
  const favAEntityId = crypto.randomUUID();
  const favBEntityId = crypto.randomUUID();

  test.beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/worldwideview?schema=public',
    });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });

    const user = await prisma.betterAuthUser.findUnique({
      where: { email: TEST_USER_EMAIL },
    });
    if (!user) throw new Error(`Test user ${TEST_USER_EMAIL} not found. Run global setup first.`);
    userId = user.id;

    // Ensure the session table has activeOrganizationId column.
    // Better Auth's organization plugin reads/writes this column via its
    // registered schema, but the Prisma model BetterAuthSession does not
    // declare it — the ALTER TABLE adds it at the database level.
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "activeOrganizationId" TEXT`,
    );

    const orgA = await prisma.pluginOrganization.create({
      data: {
        name: 'Isolation Test Org A',
        slug: `isolation-a-${Date.now()}`,
      },
    });
    orgAId = orgA.id;

    const orgB = await prisma.pluginOrganization.create({
      data: {
        name: 'Isolation Test Org B',
        slug: `isolation-b-${Date.now()}`,
      },
    });
    orgBId = orgB.id;

    await prisma.pluginMember.create({
      data: { organizationId: orgAId, userId, role: 'admin' },
    });

    await prisma.pluginMember.create({
      data: { organizationId: orgBId, userId, role: 'admin' },
    });

    // Clean up any leftover favorites from prior runs
    await prisma.$executeRawUnsafe(
      `DELETE FROM "favorites" WHERE "userId" = $1 AND "entityId" IN ($2, $3)`,
      userId, favAEntityId, favBEntityId,
    );
  });

  test.afterAll(async () => {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "favorites" WHERE "userId" = $1 AND "entityId" IN ($2, $3)`,
      userId, favAEntityId, favBEntityId,
    );
    // Reset active org on the test user's sessions
    await prisma.$executeRawUnsafe(
      `UPDATE "session" SET "activeOrganizationId" = NULL WHERE "userId" = $1`,
      userId,
    );
    await prisma.pluginMember.deleteMany({
      where: { userId, organizationId: { in: [orgAId, orgBId] } },
    });
    await prisma.pluginOrganization.deleteMany({
      where: { id: { in: [orgAId, orgBId] } },
    });
    await prisma.$disconnect();
    await pool.end();
  });

  test('favorites are isolated by active organization', async ({ page }) => {
    // Insert favorites with explicit tenantIds via raw SQL.
    // The Prisma middleware auto-sets tenantId on create, but since
    // getActiveOrgId depends on the session (which we control below),
    // we bypass the API for writes and test the READ path for isolation.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "favorites" ("id", "tenantId", "entityId", "pluginId", "label", "pluginName", "userId", "lastSeen") VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) ON CONFLICT ("userId", "entityId") DO UPDATE SET "tenantId" = $2`,
      crypto.randomUUID(), orgAId, favAEntityId, 'test-plugin', 'ORG_A_FAVORITE', 'Test Plugin', userId,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "favorites" ("id", "tenantId", "entityId", "pluginId", "label", "pluginName", "userId", "lastSeen") VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) ON CONFLICT ("userId", "entityId") DO UPDATE SET "tenantId" = $2`,
      crypto.randomUUID(), orgBId, favBEntityId, 'test-plugin', 'ORG_B_FAVORITE', 'Test Plugin', userId,
    );

    // Switch to Org A by setting activeOrganizationId directly on the
    // session row. The server-side getActiveOrgId reads this via
    // Better Auth's getSession, which includes the column because the
    // organization plugin registers it in the adapter schema.
    await prisma.$executeRawUnsafe(
      `UPDATE "session" SET "activeOrganizationId" = $1 WHERE "userId" = $2`,
      orgAId, userId,
    );

    // Org A should only see its own favorite
    const fromA = await page.request.get('/api/user/favorites');
    expect(fromA.status()).toBe(200);
    const favsFromA = await fromA.json();
    expect(favsFromA.some((f: { entityId: string }) => f.entityId === favAEntityId)).toBeTruthy();
    expect(favsFromA.some((f: { entityId: string }) => f.entityId === favBEntityId)).toBeFalsy();

    // Switch to Org B
    await prisma.$executeRawUnsafe(
      `UPDATE "session" SET "activeOrganizationId" = $1 WHERE "userId" = $2`,
      orgBId, userId,
    );

    // Org B should only see its own favorite
    const fromB = await page.request.get('/api/user/favorites');
    expect(fromB.status()).toBe(200);
    const favsFromB = await fromB.json();
    expect(favsFromB.some((f: { entityId: string }) => f.entityId === favBEntityId)).toBeTruthy();
    expect(favsFromB.some((f: { entityId: string }) => f.entityId === favAEntityId)).toBeFalsy();
  });
});
