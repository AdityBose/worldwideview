-- ============================================================
-- Migration Integrity Test — Seed Script
-- Creates the pre-Better-Auth schema (state after 5 migrations)
-- and seeds realistic test data.
-- ============================================================

BEGIN;

-- Clean slate
DROP TABLE IF EXISTS "user_api_keys" CASCADE;
DROP TABLE IF EXISTS "marketplace_credentials" CASCADE;
DROP TABLE IF EXISTS "workspace_members" CASCADE;
DROP TABLE IF EXISTS "workspaces" CASCADE;
DROP TABLE IF EXISTS "favorites" CASCADE;
DROP TABLE IF EXISTS "installed_plugins" CASCADE;
DROP TABLE IF EXISTS "settings" CASCADE;
DROP TABLE IF EXISTS "users" CASCADE;

-- Migration 1: init — core tables
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hashedPassword" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "favorites" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "entityId" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "pluginName" TEXT NOT NULL,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "notes" TEXT,
    CONSTRAINT "favorites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "installed_plugins" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "pluginId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "config" TEXT NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "installed_plugins_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subdomain" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'trialing',
    "plan" TEXT NOT NULL DEFAULT 'basic',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "ownerId" TEXT,
    "trialEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspace_members" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- Migration 2: marketplace credentials + API keys
CREATE TABLE "marketplace_credentials" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "version" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marketplace_credentials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_api_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "prefix" TEXT NOT NULL,
    "hashedSecret" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    CONSTRAINT "user_api_keys_pkey" PRIMARY KEY ("id")
);

-- Indexes from migrations 1-5
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "favorites_userId_entityId_key" ON "favorites"("userId", "entityId");
CREATE UNIQUE INDEX "installed_plugins_tenantId_pluginId_key" ON "installed_plugins"("tenantId", "pluginId");
CREATE UNIQUE INDEX "settings_tenantId_key_key" ON "settings"("tenantId", "key");
CREATE UNIQUE INDEX "workspaces_subdomain_key" ON "workspaces"("subdomain");
CREATE UNIQUE INDEX "workspace_members_userId_workspaceId_key" ON "workspace_members"("userId", "workspaceId");
CREATE UNIQUE INDEX "marketplace_credentials_tenantId_key" ON "marketplace_credentials"("tenantId");
CREATE UNIQUE INDEX "user_api_keys_prefix_key" ON "user_api_keys"("prefix");
CREATE INDEX "favorites_tenantId_idx" ON "favorites"("tenantId");
CREATE INDEX "installed_plugins_tenantId_idx" ON "installed_plugins"("tenantId");
CREATE INDEX "marketplace_credentials_tenantId_idx" ON "marketplace_credentials"("tenantId");
CREATE INDEX "settings_tenantId_idx" ON "settings"("tenantId");
CREATE INDEX "user_api_keys_tenantId_idx" ON "user_api_keys"("tenantId");

-- Foreign keys (pre-BA: all reference users.id)
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_api_keys" ADD CONSTRAINT "user_api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed data: 2 legacy NextAuth users
-- bcrypt hash of "password123" with rounds=10
-- Generated by: bcryptjs.hashSync('password123', 10)
INSERT INTO "users" ("id", "email", "name", "hashedPassword", "role", "createdAt", "sessionVersion") VALUES
('legacy-user-1', 'legacy-user-1@test.local', 'Legacy User One', '$2b$10$8hB/mFNr8rvdVbSU7nw87.eC0sa/Z922MsZ3GQX3ggFkcd07GCamG', 'ADMIN', NOW(), 0),
('legacy-user-2', 'legacy-user-2@test.local', 'Legacy User Two', '$2b$10$8hB/mFNr8rvdVbSU7nw87.eC0sa/Z922MsZ3GQX3ggFkcd07GCamG', 'user', NOW(), 0);

-- A plugin installed by user 1
INSERT INTO "installed_plugins" ("id", "tenantId", "pluginId", "version", "config", "enabled", "installedAt", "updatedAt") VALUES
('plugin-1', 'tenant-1', 'e2e-mock-plugin', '1.0.0', '{"name":"Mock Plugin"}', true, NOW(), NOW());

-- A favorite saved by user 1
INSERT INTO "favorites" ("id", "tenantId", "entityId", "pluginId", "label", "pluginName", "userId", "lastSeen") VALUES
('fav-1', 'tenant-1', 'entity-123', 'e2e-mock-plugin', 'Test Favorite', 'Mock Plugin', 'legacy-user-1', NOW());

-- A workspace
INSERT INTO "workspaces" ("id", "name", "subdomain", "status", "plan", "ownerId", "createdAt", "updatedAt") VALUES
('ws-1', 'Test Workspace', 'test-workspace', 'active', 'pro', 'legacy-user-1', NOW(), NOW());

-- Workspace membership
INSERT INTO "workspace_members" ("id", "userId", "workspaceId", "role", "joinedAt") VALUES
('wm-1', 'legacy-user-1', 'ws-1', 'admin', NOW());

COMMIT;
