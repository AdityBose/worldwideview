/* eslint-disable no-console */
import { createPublicKey, verify } from "crypto";

/** Ed25519 public key for verifying the WWV plugin registry. */
const REGISTRY_PUBLIC_KEY = "MCowBQYDK2VwAyEAk7T+s8Us85H4pR9pJt78pG2H17bUYqLSGi6ngbDvGo8=";

/** Default marketplace registry URL (configurable via env). */
const REGISTRY_URL = process.env.WWV_REGISTRY_URL ?? "https://marketplace.worldwideview.dev/api/registry";

/**
 * A plugin entry in the registry response.
 * The marketplace now returns structured objects instead of bare IDs so the
 * globe knows which plugins to auto-seed vs. which are available on demand.
 */
export interface RegistryPlugin {
  id: string;
  /** Whether this plugin should be auto-installed on fresh instances. */
  autoSeed: boolean;
}

/** Raw payload shape from the marketplace registry endpoint. */
interface RegistryPayload {
  plugins: RegistryPlugin[] | string[];
  issuedAt: string;
  signature: string;
}

/** In-memory cache. */
let cache: {
  plugins: RegistryPlugin[];
  ids: Set<string>;
  expiresAt: number;
} | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Verify the Ed25519 signature on the registry payload. */
function verifySignature(data: string, signatureB64: string): boolean {
  const keyObj = createPublicKey({
    key: Buffer.from(REGISTRY_PUBLIC_KEY, "base64"),
    format: "der",
    type: "spki",
  });
  return verify(null, Buffer.from(data), keyObj, Buffer.from(signatureB64, "base64"));
}

/**
 * Normalize the registry plugins array — handles both the new structured
 * format (`{ id, autoSeed }[]`) and the legacy format (`string[]`) for
 * backward compatibility. In the legacy format, all plugins default to
 * autoSeed: true (the previous behavior).
 */
function normalizeRegistryPlugins(
  raw: RegistryPlugin[] | string[],
): { plugins: RegistryPlugin[]; ids: Set<string> } {
  if (raw.length === 0) return { plugins: [], ids: new Set() };

  // Detect format: if the first element is a string, it's the legacy format
  const isLegacy = typeof raw[0] === "string";

  if (isLegacy) {
    const ids = new Set(raw as string[]);
    const plugins: RegistryPlugin[] = (raw as string[]).map((id) => ({
      id,
      autoSeed: true,
    }));
    return { plugins, ids };
  }

  const typed = raw as RegistryPlugin[];
  const plugins = typed.map((p) => ({ id: p.id, autoSeed: p.autoSeed }));
  const ids = new Set(typed.map((p) => p.id));
  return { plugins, ids };
}

/**
 * Fetch the signed plugin registry and return the full list of plugins with
 * their autoSeed flags. Caches for 5 minutes.
 * Returns an empty list on failure (fail-open).
 */
export async function getRegistryPluginList(): Promise<RegistryPlugin[]> {
  if (cache && Date.now() < cache.expiresAt) return cache.plugins;

  try {
    const res = await fetch(REGISTRY_URL, { next: { revalidate: 300 } });
    if (!res.ok) throw new Error(`Registry returned ${res.status}`);

    const body: RegistryPayload = await res.json();
    const { signature, ...payload } = body;
    const data = JSON.stringify(payload);

    if (!verifySignature(data, signature)) {
      console.error("[RegistryClient] Signature verification failed");
      return cache?.plugins ?? [];
    }

    const { plugins, ids } = normalizeRegistryPlugins(body.plugins);
    cache = { plugins, ids, expiresAt: Date.now() + CACHE_TTL_MS };
    return plugins;
  } catch (err) {
    console.error("[RegistryClient] Failed to fetch registry:", err);
    return cache?.plugins ?? [];
  }
}

/**
 * Fetch the signed verified-plugins registry and return the set of
 * verified plugin IDs. Caches for 5 minutes.
 * Returns an empty set on failure (fail-open: unknown plugins are unverified).
 *
 * Note: for structured plugin data (including autoSeed), use
 * `getRegistryPluginList()` instead.
 */
export async function getVerifiedPluginIds(): Promise<Set<string>> {
  if (cache && Date.now() < cache.expiresAt) return cache.ids;

  // Fetch fresh data — getRegistryPluginList() populates the shared cache
  await getRegistryPluginList();
  return cache?.ids ?? new Set();
}
