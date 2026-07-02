import { test, expect } from '@playwright/test';
import { PrismaClient } from '../src/generated/prisma/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import crypto from 'node:crypto';

const CROSS_SERVICE_SECRET = 'test-cross-service-secret-for-e2e';

function signRequest(method: string, path: string, body?: Record<string, unknown>): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();
  const bodyStr = body !== undefined ? JSON.stringify(body) : '';
  const bodyHash = crypto.createHash('sha256').update(bodyStr, 'utf8').digest('hex');
  const canon = `${method}\n${path}\n${timestamp}\n${bodyHash}`;
  const sig = crypto.createHmac('sha256', CROSS_SERVICE_SECRET).update(canon, 'utf8').digest('hex');
  return `t=${timestamp},n=${nonce},sig=${sig}`;
}

test.describe('Tier Sync API', () => {
  test.describe.configure({ mode: 'serial' });

  const SYNC_EMAIL = `tier-sync-e2e-${Date.now()}@test.local`;
  let testOrgId: string;
  let prisma: PrismaClient;
  let pool: Pool;

  test.beforeAll(async () => {
    process.env.CROSS_SERVICE_SECRET = CROSS_SERVICE_SECRET;

    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/worldwideview?schema=public',
    });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });

    const org = await prisma.pluginOrganization.create({
      data: {
        name: 'Tier Sync Test Org',
        slug: `tier-sync-test-${Date.now()}`,
      },
    });
    testOrgId = org.id;

    const user = await prisma.betterAuthUser.create({
      data: {
        email: SYNC_EMAIL,
        name: 'Tier Sync Test User',
      },
    });

    await prisma.pluginMember.create({
      data: {
        organizationId: testOrgId,
        userId: user.id,
        role: 'admin',
      },
    });
  });

  test.afterAll(async () => {
    await prisma.pluginMember.deleteMany({ where: { organizationId: testOrgId } });
    await prisma.orgTier.deleteMany({ where: { organizationId: testOrgId } });
    await prisma.betterAuthSession.deleteMany({
      where: { user: { email: SYNC_EMAIL } },
    });
    await prisma.betterAuthAccount.deleteMany({
      where: { user: { email: SYNC_EMAIL } },
    });
    await prisma.betterAuthUser.deleteMany({ where: { email: SYNC_EMAIL } });
    await prisma.pluginOrganization.deleteMany({ where: { id: testOrgId } });
    await prisma.$disconnect();
    await pool.end();
  });

  test('unsigned tier-sync request returns 401', async ({ page }) => {
    const response = await page.request.post('/api/service/tier-sync', {
      data: { email: 'test@example.com', tier: 'pro', status: 'active' },
    });
    expect(response.status()).toBe(401);
  });

  test('HMAC-signed tier-sync returns 200', async ({ page }) => {
    const body = { email: SYNC_EMAIL, tier: 'pro', status: 'active' };
    const sigHeader = signRequest('POST', '/api/service/tier-sync', body);

    const response = await page.request.post('/api/service/tier-sync', {
      data: body,
      headers: { 'X-Service-Signature': sigHeader },
    });

    if (response.status() !== 200) {
      const errBody = await response.text();
      console.error(`[tier-sync] HMAC 200 test FAIL: status=${response.status()}, body=${errBody}`);
    }
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
  });

  test('HMAC-signed with missing required fields returns 400', async ({ page }) => {
    const body = { email: 'test@test.com' };
    const sigHeader = signRequest('POST', '/api/service/tier-sync', body);

    const response = await page.request.post('/api/service/tier-sync', {
      data: body,
      headers: { 'X-Service-Signature': sigHeader },
    });

    expect(response.status()).toBe(400);
  });

  test('HMAC-signed with non-existent email returns 404', async ({ page }) => {
    const body = { email: `nonexistent-${Date.now()}@test.local`, tier: 'pro', status: 'active' };
    const sigHeader = signRequest('POST', '/api/service/tier-sync', body);

    const response = await page.request.post('/api/service/tier-sync', {
      data: body,
      headers: { 'X-Service-Signature': sigHeader },
    });

    expect(response.status()).toBe(404);
  });

  test('tier query returns synced tier after HMAC-signed sync', async ({ page }) => {
    const syncBody = { email: SYNC_EMAIL, tier: 'enterprise', status: 'active' };
    const syncSig = signRequest('POST', '/api/service/tier-sync', syncBody);

    const syncResp = await page.request.post('/api/service/tier-sync', {
      data: syncBody,
      headers: { 'X-Service-Signature': syncSig },
    });

    expect(syncResp.status()).toBe(200);

    const querySig = signRequest('GET', '/api/service/tier');
    const queryResp = await page.request.get(`/api/service/tier?email=${SYNC_EMAIL}`, {
      headers: { 'X-Service-Signature': querySig },
    });

    if (queryResp.status() !== 200) {
      const errBody = await queryResp.text();
      console.error(`[tier-sync] Query test FAIL: status=${queryResp.status()}, body=${errBody}`);
    }
    expect(queryResp.status()).toBe(200);
    const data = await queryResp.json();
    expect(data.tier).toBe('enterprise');
  });
});
