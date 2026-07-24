/**
 * @file pluginIds.ts
 * @description Canonical well-known plugin identifiers shared across the data
 * layer (subscriptions) and the UI (layer gating, overlays). Centralising these
 * prevents string drift between WsClient, AppShell, and rendering hooks — all of
 * which must agree on the exact id used as the `layers` map key.
 */

/** Plugin id for the maritime (AIS vessel) plugin. Must match the id the plugin registers its layer under. */
export const MARITIME_PLUGIN_ID = "maritime";

/**
 * Live high-churn plugins whose entities must not be restored from IndexedDB on
 * enable. These streams refill from WebSocket within seconds; painting a stale
 * fleet (wrong region / hour-old positions) breaks product trust.
 */
export const LIVE_EPHEMERAL_PLUGIN_IDS: ReadonlySet<string> = new Set([
    MARITIME_PLUGIN_ID,
]);
