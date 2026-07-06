import { isDemo } from "@/core/edition";
import { validateManifest } from "@/core/plugins/validateManifest";
import { prisma } from "../db";
import { upsertPlugin } from "./repository";
import { getRegistryPluginList } from "./registryClient";

const MARKETPLACE_URL = process.env.NEXT_PUBLIC_MARKETPLACE_URL
    || "https://marketplace.worldwideview.dev";

/**
 * Seed verified marketplace plugins on a fresh install.
 *
 * The signed registry (`getRegistryPluginList`) is the single source of truth.
 * Only plugins with `autoSeed: true` are auto-installed on fresh instances.
 * Publish a plugin with `autoSeed: true` in the registry and it auto-seeds
 * on subsequent fresh installs.
 *
 * Runs at most once per instance lifecycle: an idempotent guard
 * (`defaults_seeded` in the Setting table) prevents re-runs. If the registry
 * is empty or unreachable on first attempt, the guard is NOT set — the next
 * request retries.
 *
 * Errors are logged but never thrown — a failed seed must never block the
 * application from starting.
 */
export async function seedDefaultPlugins(): Promise<void> {
    try {
        // Demo has its own mechanism (NEXT_PUBLIC_DEMO_DEFAULT_PLUGINS)
        if (isDemo) return;

        // Opt-out for power users deploying fresh instances
        if (process.env.WWV_SKIP_DEFAULT_PLUGINS === "true") {
            await markSeeded();
            return;
        }

        // Idempotent guard — already seeded?
        const guard = await prisma.setting.findFirst({
            where: { key: "defaults_seeded" },
        });
        if (guard) return;

        // Not truly fresh if plugins already exist
        const existing = await prisma.installedPlugin.count();
        if (existing > 0) {
            await markSeeded();
            return;
        }

        const autoSeedPlugins = (await getRegistryPluginList()).filter((p) => p.autoSeed);
        if (autoSeedPlugins.length === 0) {
            // Registry unreachable / signature failed / empty — defer so the
            // next request retries instead of locking in an empty fresh install.
            console.warn(
                "[DefaultPlugins] No autoSeed plugins in registry — deferring seed, will retry next request",
            );
            return;
        }

        console.log(
            `[DefaultPlugins] Fresh install detected — seeding ${autoSeedPlugins.length} auto-seed plugins\u2026`,
        );

        let installed = 0;

        for (const plugin of autoSeedPlugins) {
            try {
                const manifest = await fetchManifest(plugin.id);
                if (!manifest) continue;

                // Every plugin in the verified set is by definition verified.
                manifest.trust = "verified";

                // Reconstruct CDN entry for npm-distributed plugins
                if (manifest.npmPackage) {
                    const ver = manifest.version || "1.0.0";
                    manifest.format = "bundle";
                    manifest.entry = `https://unpkg.com/${manifest.npmPackage}@${ver}/dist/frontend.mjs`;
                }

                const validation = validateManifest(manifest);
                if (!validation.valid) {
                    console.warn(
                        `[DefaultPlugins] Skipping ${plugin.id}: ${validation.errors.join(", ")}`,
                    );
                    continue;
                }

                await upsertPlugin(
                    plugin.id,
                    (manifest.version as string | undefined) || "1.0.0",
                    JSON.stringify(manifest),
                );
                installed += 1;
            } catch (err) {
                console.warn(
                        `[DefaultPlugins] Failed to seed ${plugin.id}:`,
                    err,
                );
            }
        }

        await markSeeded();
        console.log(
            `[DefaultPlugins] Seeded ${installed}/${autoSeedPlugins.length} plugins`,
        );
    } catch (err) {
        console.error("[DefaultPlugins] Seeder failed:", err);
        // Never throw — seeding failure must not block the app
    }
}

/** Fetch a plugin manifest from the marketplace API. */
async function fetchManifest(
    pluginId: string,
): Promise<Record<string, unknown> | null> {
    try {
        const res = await fetch(`${MARKETPLACE_URL}/api/plugins/${pluginId}`);
        if (!res.ok) {
            console.warn(
                `[DefaultPlugins] Marketplace returned ${res.status} for ${pluginId}`,
            );
            return null;
        }
        const data = await res.json();
        if (!data.id) data.id = pluginId;
        return data;
    } catch (err) {
        console.warn(
            `[DefaultPlugins] Network error fetching ${pluginId}:`,
            err,
        );
        return null;
    }
}

/** Write the idempotent guard row. */
async function markSeeded(): Promise<void> {
    const existing = await prisma.setting.findFirst({ where: { key: "defaults_seeded" } });
    if (existing) {
        await prisma.setting.updateMany({
            where: { key: "defaults_seeded" },
            data: { value: "true" },
        });
    } else {
        await prisma.setting.create({
            data: { key: "defaults_seeded", value: "true" },
        });
    }
}
