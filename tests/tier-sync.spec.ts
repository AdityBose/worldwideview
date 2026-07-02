import { test, expect } from '@playwright/test';
import { PrismaClient } from '../src/generated/prisma/index.js';
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import crypto from 'node:crypto';
import { signCrossServiceRequest } from '../src/lib/cross-service/sign';

const SYNC_EMAIL = `tier-sync-${Date.now()}@test.local`;

test.describe('Tier Sync API', () => {
  test.describe.configure({ mode: 'serial' });

  let prisma: PrismaClient;
  let pool: Pool;
  let orgId: string;
  let userId: string;

  test.beforeAll(async () => {
    process.env.CROSS_SERVICE_SECRET = 'test-cross-service-secret-for-e2e';
    pool = new Pool({ connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/worldwideview?schema=public" });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });

    userId = crypto.randomUUID();
    orgId = crypto.randomUUID();

    await prisma.betterAuthUser.create({
      data: {
        id: userId,
        email: SYNC_EMAIL,
        name: 'Tier Sync Test',
        emailVerified: true,
        role: 'user',
      },
    });

    await prisma.pluginMember.create({
      data: {
        organizationId: orgId,
        userId,
        role: 'admin',
        createdAt: new Date(),
      },
    });

    await prisma.pluginOrganization.create({
      data: {
        id: orgId,
        name: 'Tier Sync Test Org',
        slug: `tier-sync-${Date.now()}`,
      },
    });
  });

  test.afterAll(async () => {
    await prisma.orgTier.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma.pluginMember.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.pluginOrganization.deleteMany({ where: { id: orgId } }).catch(() => {});
    await prisma.betterAuthUser.deleteMany({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
    await pool.end();
  });

  test('HMAC-signed tier-sync request returns 200 and updates tier', async ({ page }) => {
    const body = { email: SYNC_EMAIL, tier: 'pro', status: 'active' };
    const bodyStr = JSON.stringify(body);
    const headers = signCrossServiceRequest({ method: 'POST', path: '/api/service/tier-sync', body });

    const response = await page.request.post('/api/service/tier-sync', {
      data: bodyStr,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });

    expect(response.status()).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.organizationId).toBe(orgId);
    expect(json.tier).toBe('pro');
    expect(json.status).toBe('active');
  });

  test('unsigned request returns 401', async ({ page }) => {
    const response = await page.request.post('/api/service/tier-sync', {
      data: { email: SYNC_EMAIL, tier: 'pro', status: 'active' },
    });
    expect(response.status()).toBe(401);
  });

  test('invalid body returns 400', async ({ page }) => {
    const body = {};
    const bodyStr = JSON.stringify(body);
    const headers = signCrossServiceRequest({ method: 'POST', path: '/api/service/tier-sync', body });

    const response = await page.request.post('/api/service/tier-sync', {
      data: bodyStr,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
    expect(response.status()).toBe(400);
  });

  test('non-existent email returns 404', async ({ page }) => {
    const body = { email: 'nonexistent@test.local', tier: 'free', status: 'active' };
    const bodyStr = JSON.stringify(body);
    const headers = signCrossServiceRequest({ method: 'POST', path: '/api/service/tier-sync', body });

    const response = await page.request.post('/api/service/tier-sync', {
      data: bodyStr,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
    expect(response.status()).toBe(404);
  });

  test('tier query returns updated tier after sync', async ({ page }) => {
    const headers = signCrossServiceRequest({ method: 'GET', path: '/api/service/tier' });

    const response = await page.request.get(`/api/service/tier?email=${encodeURIComponent(SYNC_EMAIL)}`, {
      headers,
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.tier).toBe('pro');
    expect(body.status).toBe('active');
    expect(body.effectiveTier).toBe('pro');
  });
});
