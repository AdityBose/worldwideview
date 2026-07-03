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

    // Ensure the session table has activeOrganizationId column so the
    // set-active Better Auth API stores the active org in the session row.
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

    await prisma.favorite.deleteMany({
      where: { userId, entityId: { in: [favAEntityId, favBEntityId] } },
    });
  });

  test.afterAll(async () => {
    await prisma.favorite.deleteMany({
      where: { userId, entityId: { in: [favAEntityId, favBEntityId] } },
    });
    await prisma.pluginMember.deleteMany({
      where: { userId, organizationId: { in: [orgAId, orgBId] } },
    });
    await prisma.pluginOrganization.deleteMany({
      where: { id: { in: [orgAId, orgBId] } },
    });
    await prisma.$disconnect();
    await pool.end();
  });

  test('Org A data is invisible to Org B', async ({ page }) => {
    const setA = await page.request.post('/api/ba/organization/set-active', {
      data: { organizationId: orgAId },
    });
    expect(setA.status()).toBe(200);

    const create = await page.request.post('/api/user/favorites', {
      data: {
        entityId: favAEntityId,
        pluginId: 'test-plugin',
        label: 'ORG_A_FAVORITE',
        pluginName: 'Test Plugin',
      },
    });
    expect(create.status()).toBe(200);

    const afterCreate = await page.request.get('/api/user/favorites');
    expect(afterCreate.status()).toBe(200);
    const favsAfterCreate = await afterCreate.json();
    expect(favsAfterCreate.some((f: { entityId: string }) => f.entityId === favAEntityId)).toBeTruthy();

    const setB = await page.request.post('/api/ba/organization/set-active', {
      data: { organizationId: orgBId },
    });
    expect(setB.status()).toBe(200);

    const fromB = await page.request.get('/api/user/favorites');
    expect(fromB.status()).toBe(200);
    const favsFromB = await fromB.json();
    expect(favsFromB.some((f: { entityId: string }) => f.entityId === favAEntityId)).toBeFalsy();
  });

  test('Org B data is isolated from Org A', async ({ page }) => {
    const createB = await page.request.post('/api/user/favorites', {
      data: {
        entityId: favBEntityId,
        pluginId: 'test-plugin',
        label: 'ORG_B_FAVORITE',
        pluginName: 'Test Plugin',
      },
    });
    expect(createB.status()).toBe(200);

    const fromB = await page.request.get('/api/user/favorites');
    expect(fromB.status()).toBe(200);
    const favsFromB = await fromB.json();
    expect(favsFromB.some((f: { entityId: string }) => f.entityId === favAEntityId)).toBeFalsy();
    expect(favsFromB.some((f: { entityId: string }) => f.entityId === favBEntityId)).toBeTruthy();

    const setA = await page.request.post('/api/ba/organization/set-active', {
      data: { organizationId: orgAId },
    });
    expect(setA.status()).toBe(200);

    const fromA = await page.request.get('/api/user/favorites');
    expect(fromA.status()).toBe(200);
    const favsFromA = await fromA.json();
    expect(favsFromA.some((f: { entityId: string }) => f.entityId === favAEntityId)).toBeTruthy();
    expect(favsFromA.some((f: { entityId: string }) => f.entityId === favBEntityId)).toBeFalsy();
  });
});
