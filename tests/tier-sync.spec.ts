import { test, expect } from '@playwright/test';
import { PrismaClient } from '../src/generated/prisma/index.js';
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import crypto from 'node:crypto';

const TEST_SECRET = 'test-cross-service-secret-for-e2e';
const SYNC_EMAIL = `tier-sync-${Date.now()}@test.local`;

function signRequest(method: string, path: string, body: unknown, secret: string) {
  const nonce = crypto.randomUUID();
  const timestamp = Math.floor(Date.now() / 1000);
  const bodyStr = body !== undefined ? JSON.stringify(body) : '';
  const bodyHash = crypto.createHash('sha256').update(bodyStr, 'utf8').digest('hex');
  const canon = `${method}\n${path}\n${timestamp}\n${bodyHash}`;
  const sig = crypto.createHmac('sha256', secret).update(canon, 'utf8').digest('hex');
  return {
    'X-Service-Signature': `t=${timestamp},n=${nonce},sig=${sig}`,
    'Content-Type': 'application/json',
  };
}

test.describe('Tier Sync API', () => {
  test.describe.configure({ mode: 'serial' });

  let prisma: PrismaClient;
  let pool: Pool;
  let orgId: string;
  let userId: string;

  test.beforeAll(async () => {
    process.env.CROSS_SERVICE_SECRET = TEST_SECRET;
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
    const headers = signRequest('POST', '/api/service/tier-sync', {
      email: SYNC_EMAIL,
      tier: 'pro',
      status: 'active',
    }, TEST_SECRET);

    const response = await page.request.post('/api/service/tier-sync', {
      data: { email: SYNC_EMAIL, tier: 'pro', status: 'active' },
      headers,
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.organizationId).toBe(orgId);
    expect(body.tier).toBe('pro');
    expect(body.status).toBe('active');
  });

  test('unsigned request returns 401', async ({ page }) => {
    const response = await page.request.post('/api/service/tier-sync', {
      data: { email: SYNC_EMAIL, tier: 'pro', status: 'active' },
    });
    expect(response.status()).toBe(401);
  });

  test('invalid body returns 400', async ({ page }) => {
    const headers = signRequest('POST', '/api/service/tier-sync', {}, TEST_SECRET);

    const response = await page.request.post('/api/service/tier-sync', {
      data: {},
      headers,
    });
    expect(response.status()).toBe(400);
  });

  test('non-existent email returns 404', async ({ page }) => {
    const headers = signRequest('POST', '/api/service/tier-sync', {
      email: 'nonexistent@test.local',
      tier: 'free',
      status: 'active',
    }, TEST_SECRET);

    const response = await page.request.post('/api/service/tier-sync', {
      data: { email: 'nonexistent@test.local', tier: 'free', status: 'active' },
      headers,
    });
    expect(response.status()).toBe(404);
  });

  test('tier query returns updated tier after sync', async ({ page }) => {
    const headers = signRequest('GET', `/api/service/tier?email=${encodeURIComponent(SYNC_EMAIL)}`, undefined, TEST_SECRET);

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
