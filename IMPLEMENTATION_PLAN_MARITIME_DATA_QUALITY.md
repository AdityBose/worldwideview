# Implementation Plan — Maritime Data Quality Fixes

**Date:** 2026-07-20  
**Updated:** 2026-07-20 (safe-fix constraints, do/don’t per problem, deferred guidance)  
**Scope:** Residual frontend/seeder bugs that make displayed maritime data unreliable  
**Status:** Planned (not yet implemented)  
**Related docs:** `RCA_MARITIME_DATA_HYDRATION.md`, `IMPLEMENTATION_PLAN_DYNAMIC_AIS.md`

---

## 0. Safe-fix principle (read first)

> Change **maritime-only behavior** behind shared IDs (`MARITIME_PLUGIN_ID` / `LIVE_EPHEMERAL_PLUGIN_IDS`).  
> Do **not** change global defaults for every plugin (cache TTL, payload handling, subscribe semantics).

Analogy: fix one subway line’s signals without rewiring the whole city’s traffic lights.

| Rule | Meaning |
|------|---------|
| **Scope by ID** | Branch on `MARITIME_PLUGIN_ID` or membership in `LIVE_EPHEMERAL_PLUGIN_IDS` — never “all plugins” or “all WS payloads” |
| **Plugin mapper wins** | Core maritime fallback runs only when `mapWebsocketPayload` is absent |
| **No global cache surgery** | Do not lower `cacheMaxAge` or disable IDB for aviation/static/other layers |
| **One clear API** | Entity wipe and count reset stay in `clearEntities` so callers cannot drift |
| **Probe before subscribe changes** | Empty `boundingBoxes` must be verified against engine semantics before shipping |
| **Nested repo isolation** | Seeder log/entry fixes commit in `local-seeders/community/maritime`, not the main app bundle |
| **Regression gate every phase** | `pnpm test` on WsClient + dataSlice + PluginManager; manual maritime enable/pan/zoom-out; confirm non-maritime still IDB-hydrates |

### Hard non-breaks (features that must still work after every phase)

| Feature | Why it can break | Guard |
|---------|------------------|-------|
| Plugin `mapWebsocketPayload` override | Core mapper runs first or replaces plugin path | Always call plugin mapper first when present |
| Array-shaped WS payloads (cloud) | Mapper assumes only dicts | Return `null` for arrays; keep existing array path |
| Aviation / static IDB instant enable | Global cache disable or TTL cut | Ephemeral set only includes maritime (unless explicitly extended) |
| Antimeridian bbox split | Null-viewport rewrite touches box builder carelessly | Leave non-null viewport branch unchanged; tests stay green |
| Skip-clear when socket not OPEN | Extra invalidate/clear logic runs when no ready engine | Keep `readyEngines.length === 0 → return` before clear |
| Boot “max update depth” protection | Someone removes all `setTimeout(0)` while fixing races | Problem 4 deferred; do not strip DataBus deferrals in this plan |
| Seeder snapshot consumers | Changing seeder publish shape mid-frontend fix | Normalize at browser edge only (Problem 2) |
| Engine mount path for maritime seeder | Renaming entry without compose/engine update | Problem 8 deferred; if touched later, dual-emit or fix `main` + mount together |

---

## 1. Why this plan exists

WorldWideView’s product trust depends on one property:

> When the user looks at the globe, the ships they see must be a faithful, fresh representation of the live feed — not a stale cache, a wrong region, or silent data drop.

A prior RCA concluded that many empty-ocean “blind spots” are AISStream free-tier coverage. That remains true for regions with no upstream AIS. This plan addresses a different class of defect: **bugs that make even good upstream data look wrong, empty, or contradictory**.

### In scope (this plan)

| # | Severity | Problem |
|---|----------|---------|
| 2 | High | Payload shape mismatch can drop all ships |
| 3 | High | IndexedDB cache rehydrates stale maritime data |
| 5 | Medium | `clearEntities` leaves stale `entityCount` |
| 6 | Medium | Zoomed-out behavior contradicts itself (HUD vs Malacca fallback) |
| 9 | Low | Seeder per-message raw logging hurts performance under load |

### Out of scope (explained separately in chat; deferred)

| # | Problem |
|---|----------|
| 4 | `setTimeout(0)` race can undo `clearEntities` |
| 7 | Seeder keeps ships for 6 hours (ghost vessels) |
| 8 | Seeder `package.json` `"main"` points at missing file |
| 10 | RCA / plan docs disagree with local seeder behavior |
| 1 | Seeder ignores client `boundingBoxes` (engine/seeder contract; separate plan) |

### Local vs cloud viewport contract (must stay consistent with other plans)

| Environment | Dynamic client `boundingBoxes` effect on AISStream today | What acceptance tests may promise |
|---|---|---|
| **Local seeder** (`local-seeders/community/maritime`) | **Ignored** — seeder hardcodes a global box; engine may accept the WS field but does not drive seeder demand yet | Zoom/pan UX, paint gates, payload mapping, cache policy — **not** “only ships inside the camera box arrive from AIS” |
| **Cloud hosted engine** | **Unverified / historically ignores per-client boxes** for multi-tenant safety | Do **not** claim zero-key multiplexed custom-region AIS via browser boxes alone (`IMPLEMENTATION_PLAN_DYNAMIC_AIS.md` must not contradict this) |
| **Future engine+seeder demand hook** | Optional `updateDemand` / bbox union (ADR required) | Only after engine repo change ships |

`IMPLEMENTATION_PLAN_DYNAMIC_AIS.md` describes the **frontend subscription frames** and intended demand path. It must **not** present cloud-to-AIS viewport filtering as a working guarantee until confirmed.

---

## 2. Goals and non-goals

### Goals

1. **Never silently discard a live maritime payload** when the shape is a known seeder dict (`MMSI → ship state`).
2. **Never re-show ships from a previous session/region** when maritime is re-enabled or the viewport changes, unless those ships are still in the live stream.
3. **Layer panel counts must match what is on the globe** after clear, pan, and disable.
4. **Zoomed-out UX must be honest** — HUD copy and subscription behavior must describe the same reality.
5. **Seeder hot path must not log every AIS frame** in production-like runs.

### Non-goals

- Fixing AISStream free-tier geographic coverage.
- Teaching the local seeder to honor client `boundingBoxes` (Problem 1 — separate engine work).
- Reworking the full DataBus `setTimeout` architecture (Problem 4 — deferred).
- Changing Redis snapshot TTL policy beyond what Problem 3 requires on the client.
- Changing global `cacheMaxAge` or disabling IndexedDB for non-maritime plugins.
- Changing the seeder live-snapshot object shape (MMSI dict) as part of the frontend fix.
- Removing DataBus `setTimeout(0)` deferrals project-wide.

### Success criteria (definition of done)

| ID | Criterion | How to verify |
|----|-----------|---------------|
| SC-2 | Object-shaped maritime payloads become `GeoEntity[]` and render | Unit test + manual: force object payload, ships appear |
| SC-3a | Enabling maritime never paints IndexedDB ships older than a short live TTL without a live frame | Toggle layer off→on; no flash of previous-region vessels |
| SC-3b | Viewport clear also invalidates maritime cache entry | After pan, disable/enable does not restore pre-pan ships from cache |
| SC-5 | After `clearEntities("maritime")`, layer `entityCount` is `0` | Unit test on data/layers slice or integration assert |
| SC-6 | When HUD says “zoom in…”, client does **not** subscribe to Malacca (or HUD is removed/rewritten to match chosen behavior) | Code review + manual zoom-out check |
| SC-9 | Seeder does not `console.log` full raw AIS JSON per message at default log level | Grep + run seeder under load; CPU/log volume drops |

---

## 3. Current architecture (relevant path only)

```
AISStream WS
    → maritime seeder (activeFleetCache Map)
    → setLiveSnapshot("maritime", Object.fromEntries(cache), ttl)
    → data engine Redis + broadcast
    → browser WsClient.handleDataMessage
         ├─ if plugin.mapWebsocketPayload → use it
         ├─ else if Array.isArray(payload) → normalize timestamps
         └─ else → WARN and DROP
    → dataBus.emit("dataUpdated")
    → DataBusSubscriber setTimeout(0) → setEntities + setEntityCount
    → GlobeView reads entitiesByPlugin

Parallel path on enable:
    PluginManager.enablePlugin
    → cacheLayer.get / getFromPersistent (TTL = cacheMaxAge, default 1h)
    → dataBus.emit("dataUpdated", cached)   // can paint stale ships
    → wsClient.subscribe → live frames later
```

Key files:

| File | Role |
|------|------|
| `src/core/data/WsClient.ts` | WS ingest, viewport subscribe, `clearEntities` on pan |
| `src/core/data/CacheLayer.ts` | Memory + IndexedDB entity cache |
| `src/core/plugins/PluginManager.ts` | enable → cache hydrate → poll/WS |
| `src/core/state/dataSlice.ts` | `setEntities` / `clearEntities` |
| `src/core/state/layersSlice.ts` | `entityCount` per layer |
| `src/core/plugins/layerActivation.ts` | disable path clears entities + count |
| `src/components/layout/DataBusSubscriber.tsx` | DataBus → Zustand bridge |
| `src/components/layout/AppShell.tsx` | Maritime zoom HUD |
| `src/core/plugins/pluginIds.ts` | `MARITIME_PLUGIN_ID` |
| `local-seeders/community/maritime/dist/index.mjs` | AIS ingest + snapshot |

---

## 4. Problem deep-dives and design

### 4.1 Problem 2 — Payload shape mismatch drops all ships

#### Symptom
Console warning:

```text
[WsClient] Payload for maritime is an object but no mapWebsocketPayload exists. Ignoring.
```

Globe stays empty (or only shows whatever cache painted earlier) even though the engine is broadcasting.

#### Root cause
Seeder publishes:

```js
// local-seeders/community/maritime/dist/index.mjs
await setLiveSnapshot("maritime", Object.fromEntries(activeFleetCache), 6 * 3600);
// shape: { "419000001": { id, mmsi, name, lat, lon, hdg, spd, last_updated }, ... }
```

SDK contract expects `WsStreamPayload.payload?: GeoEntity[]`.  
`WsClient.handleDataMessage` only accepts non-arrays when a loaded plugin defines `mapWebsocketPayload`.  
`local-plugins/` currently has no maritime plugin bundle, so the mapper is absent → **drop**.

#### Design decision

Prefer a **defense-in-depth core fallback** so the product does not depend on marketplace plugin presence for basic maritime rendering:

1. **Primary (core):** In `WsClient.handleDataMessage`, if `pluginId === MARITIME_PLUGIN_ID` and payload is a plain object (not array, not null), run a pure mapper `mapMaritimeFleetPayload(payload) → GeoEntity[]`.
2. **Secondary (plugin, when present):** If `mapWebsocketPayload` exists, it still wins (plugin can add richer fields, trails, filters).
3. **Do not** change the seeder snapshot shape in this plan (engine consumers may already key by MMSI). Shape normalization stays at the browser edge until a coordinated seeder+engine contract change.

#### Do / Don’t (safe fix)

| Do | Don’t |
|----|-------|
| Add pure `mapMaritimeFleetPayload` used only when `pluginId === MARITIME_PLUGIN_ID` | Broaden `WsStreamPayload` to “any object” for all plugins |
| Call plugin `mapWebsocketPayload` **first** when present | Replace or remove the plugin mapper path |
| Accept both array and dict shapes (dict → map; array → existing path) | Assume cloud always sends dicts or always arrays |
| Drop invalid rows; empty dict → `[]` + still emit | Fail the whole frame on one bad ship |
| Normalize at the browser edge | Change seeder `Object.fromEntries(activeFleetCache)` shape in the same PR |

#### Mapper contract

Input ship record (seeder) — **coordinate and timestamp aliases are first-class**, not optional prose:

```ts
type MaritimeShipState = {
  id?: string;
  mmsi?: string | number; // normalized to string on the entity
  name?: string;
  // Coordinates: accept either pair
  lat?: number;
  lon?: number;
  latitude?: number;  // alias of lat
  longitude?: number; // alias of lon
  hdg?: number;
  heading?: number;   // alias of hdg
  spd?: number;
  speed?: number;     // alias of spd
  last_updated?: number; // unix seconds or ms
  lastUpdated?: number;  // alias
};
// or Record<mmsi, MaritimeShipState>
```

Alias rules (must be tested):
- `lat` / `lon` preferred when present; else `latitude` / `longitude`.
- Invalid or out-of-range coords → drop row (do not fail whole frame).
- `properties.mmsi` is always the **normalized string** (spread raw first, then assign `mmsi`).
- `last_updated` outside the valid JS Date range → fall back to `new Date()` (now), never `Invalid Date`.

Output `GeoEntity` minimum:

```ts
{
  id: ship.id ?? `mmsi-${mmsi}`,
  pluginId: MARITIME_PLUGIN_ID,
  latitude: ship.lat,
  longitude: ship.lon,
  altitude: 0,
  heading: Number.isFinite(ship.hdg) && ship.hdg >= 0 && ship.hdg < 360 ? ship.hdg : undefined,
  speed: ship.spd,
  timestamp: new Date((ship.last_updated ?? Date.now() / 1000) * 1000),
  label: ship.name?.trim() || `MMSI ${mmsi}`,
  properties: { mmsi, ...remaining },
}
```

Validation rules (drop bad rows, do not fail the whole frame):

- `lat`/`lon` must be finite; lat ∈ [-90, 90], lon ∈ [-180, 180]
- skip keys whose value is not an object
- empty object → `[]` (valid clear), not a drop/warn-as-error

#### Files to touch

| File | Change |
|------|--------|
| `src/core/data/mapMaritimePayload.ts` (**new**) | Pure mapper + type guards |
| `src/core/data/mapMaritimePayload.test.ts` (**new**) | Unit tests |
| `src/core/data/WsClient.ts` | Call mapper in `handleDataMessage` before ignore branch |
| `src/core/data/WsClient.spec.ts` / `.test.ts` | Object payload → entities dispatched |

#### Implementation steps

1. Add `mapMaritimeFleetPayload(payload: unknown): GeoEntity[] | null`
   - `null` = “not a maritime fleet object” (caller continues existing logic)
   - `GeoEntity[]` = mapped (possibly empty)
2. In `handleDataMessage`:

```ts
if (plugin && typeof plugin.mapWebsocketPayload === "function") {
  finalEntities = plugin.mapWebsocketPayload(data.payload, existingEntities);
} else if (pluginId === MARITIME_PLUGIN_ID) {
  const mapped = mapMaritimeFleetPayload(data.payload);
  if (mapped) {
    finalEntities = mapped;
  } else if (Array.isArray(data.payload)) {
    finalEntities = normalizeTimestamps(data.payload);
  } else {
    console.warn(...); return;
  }
} else if (!Array.isArray(data.payload)) {
  console.warn(...); return;
} else {
  finalEntities = normalizeTimestamps(data.payload);
}
```

3. Tests:
   - dict of 3 ships → 3 GeoEntities with correct lat/lon/id
   - array payload still works without mapper
   - invalid lat dropped
   - empty dict → `[]` and still emits `dataUpdated` (allows live clear)
   - plugin `mapWebsocketPayload` still overrides
   - `latitude`/`longitude` aliases map the same as `lat`/`lon`
   - numeric upstream `mmsi` becomes string in `properties.mmsi`
   - out-of-range `last_updated` does not produce Invalid Date

#### Risks / mitigations

| Risk | Mitigation |
|------|------------|
| Engine already sends arrays in cloud | Mapper returns `null` for arrays; array path unchanged |
| Field names differ (`latitude` vs `lat`) | Accept both in mapper |
| Huge fleets (10k+ keys) block main thread | Map in one pass; follow-up: incremental merge (out of scope) |

---

### 4.2 Problem 3 — IndexedDB cache rehydrates stale maritime data

#### Symptom
User pans away from Region A, or disables maritime, later re-enables: ships from Region A (or an hour-old snapshot) flash onto the globe before live data arrives — or stick if live frames are sparse.

#### Root cause
1. `PluginManager.enablePlugin` always tries memory → IndexedDB hydrate and emits `dataUpdated` immediately.
2. Default `cacheMaxAge` is **3_600_000 ms (1 hour)** (`configSlice.ts`).
3. Viewport path calls `clearEntities(MARITIME_PLUGIN_ID)` but **never** `cacheLayer.invalidate(MARITIME_PLUGIN_ID)`.
4. Live maritime is a stream, not a poll snapshot — caching full fleets like static GeoJSON is the wrong default.

#### Design decision

Treat maritime (and, by extension, any high-churn live WS plugin we opt in) as **cache-volatile**:

| Action | Cache behavior |
|--------|----------------|
| Live `dataUpdated` from WS | Optional short-lived memory cache only (see below) **or** skip persistent write |
| Viewport clear | `clearEntities` + `cacheLayer.invalidate(MARITIME_PLUGIN_ID)` |
| `disablePlugin` / layer off | Already clears managed entities; also `invalidate` |
| `enablePlugin` | **Skip persistent hydrate** for maritime; show loading until first live frame |

Recommended policy constants (single source):

```ts
// src/core/plugins/pluginIds.ts (or new livePlugins.ts)
export const MARITIME_PLUGIN_ID = "maritime";

/** Plugin IDs whose entities must not be restored from IndexedDB on enable. */
export const LIVE_EPHEMERAL_PLUGIN_IDS: ReadonlySet<string> = new Set([
  MARITIME_PLUGIN_ID,
]);
```

#### Do / Don’t (safe fix)

| Do | Don’t |
|----|-------|
| Skip IDB hydrate + skip `cacheLayer.set` **only** for IDs in `LIVE_EPHEMERAL_PLUGIN_IDS` | Lower global `cacheMaxAge` (breaks slow/static layers’ instant enable) |
| `invalidate(MARITIME_PLUGIN_ID)` on viewport clear, disable, and one-time boot cleanup | Disable IndexedDB for the whole app |
| Keep aviation/static PluginManager hydrate tests green unchanged | Rewrite `enablePlugin` to never read cache for anyone |
| Prefer no cache write for maritime (Option A) until measured need | Invent a second parallel cache system |
| Use the shared set so future live plugins opt in explicitly | Scatter raw `=== "maritime"` checks with divergent policy |

#### Files to touch

| File | Change |
|------|--------|
| `src/core/plugins/pluginIds.ts` | Add `LIVE_EPHEMERAL_PLUGIN_IDS` (or sibling module) |
| `src/core/plugins/PluginManager.ts` | Skip IDB hydrate for ephemeral IDs; skip `cacheLayer.set` persistent path for them |
| `src/core/data/CacheLayer.ts` | Optional: `setMemoryOnly(pluginId, entities, ttl)` **or** `set(..., { persist: false })` |
| `src/core/data/WsClient.ts` | On viewport clear, `cacheLayer.invalidate(MARITIME_PLUGIN_ID)` |
| `src/core/plugins/layerActivation.ts` | On disable, `cacheLayer.invalidate(pluginId)` for ephemeral IDs (belt-and-suspenders) |
| Tests | PluginManager enable does not emit cached maritime; invalidate on clear |

#### Implementation steps

1. **Classify maritime as ephemeral** via shared set (avoid scattering string compares).
2. **`enablePlugin`:**

```ts
const ephemeral = LIVE_EPHEMERAL_PLUGIN_IDS.has(pluginId);
let cached = null;
if (!ephemeral) {
  cached = cacheLayer.get(pluginId) ?? await cacheLayer.getFromPersistent(pluginId);
}
if (cached && managed.enabled) {
  managed.entities = cached;
  dataBus.emit("dataUpdated", { pluginId, entities: cached });
}
```

3. **`handleDataUpdate`:** For ephemeral plugins, either:
   - **Option A (preferred):** do not call `cacheLayer.set` at all, or
   - **Option B:** `cacheLayer.set` with `persist: false` and TTL ≤ 30s for instant re-mount within same SPA session only.

   Prefer **Option A** for maritime until a measured need for memory cache appears. Live WS will refill within seconds when connected.

4. **Viewport clear in `WsClient.updateViewportSubscriptions`:**

```ts
useStore.getState().clearEntities(MARITIME_PLUGIN_ID);
cacheLayer.invalidate(MARITIME_PLUGIN_ID);
// also reset entityCount — see Problem 5
```

5. **Disable path:** In `PluginManager.disablePlugin` and/or `layerActivation`, invalidate cache for ephemeral IDs.

6. **Migration / one-time cleanup:** On app boot (CacheLayer.init success), proactively `invalidate(MARITIME_PLUGIN_ID)` once so existing browsers drop hour-old IDB fleets written before this fix.

#### Risks / mitigations

| Risk | Mitigation |
|------|------------|
| Slower perceived enable (blank until first WS frame) | Keep layer `loading: true` until first live `dataUpdated`; HUD already covers zoom-out |
| Other live plugins need same treatment later | Shared `LIVE_EPHEMERAL_PLUGIN_IDS` set |
| Tests assume cache hydrate for all plugins | Update maritime-specific cases only |

---

### 4.3 Problem 5 — `clearEntities` leaves stale `entityCount`

#### Symptom
User pans; ships clear from globe but layer row still shows e.g. “1,240” until the next successful frame.

#### Root cause
`dataSlice.clearEntities` only deletes `entitiesByPlugin[id]`.  
`entityCount` lives in `layersSlice` and is updated on `dataUpdated` (via DataBusSubscriber) or on full layer deactivate (`layerActivation` sets count to 0). Viewport clear bypasses both.

#### Design decision

Make “clear plugin entities” a **single store operation** that keeps entities and counts aligned — callers should not need to remember two APIs.

**Preferred:** extend `clearEntities` to also zero `entityCount` for that plugin (same Zustand `set`).

#### Do / Don’t (safe fix)

| Do | Don’t |
|----|-------|
| Zero `entityCount` inside `clearEntities` (one Zustand `set`) | Add a second `clearPluginData` API that only some callers use |
| Keep `layerActivation`’s explicit `setEntityCount(0)` (idempotent) or drop it after tests | Change `setEntities` semantics or selection-refresh behavior |
| Update `dataSlice` JSDoc so the dual effect is documented | Touch unrelated layer fields (`enabled`, `loading`) inside clear |

```ts
// dataSlice — needs access to layers fields on AppStore
clearEntities: (pluginId) => set((state) => {
  const entitiesByPlugin = { ...state.entitiesByPlugin };
  delete entitiesByPlugin[pluginId];
  const layers = { ...state.layers };
  if (layers[pluginId]) {
    layers[pluginId] = { ...layers[pluginId], entityCount: 0 };
  }
  return { entitiesByPlugin, layers };
}),
```

Because slices share `AppStore`, this is valid on the combined store creator.

**Alternative (if slice purity is preferred):** add `clearPluginData(pluginId)` in a small helper used by WsClient + layerActivation that calls both. Less ideal — two call sites already drift.

Also ensure viewport path does not need a separate `setEntityCount` if `clearEntities` owns it.

#### Files to touch

| File | Change |
|------|--------|
| `src/core/state/dataSlice.ts` | Zero `entityCount` inside `clearEntities` |
| `src/core/state/dataSlice.test.ts` | Assert count resets |
| `src/core/plugins/layerActivation.ts` | Can keep explicit `setEntityCount(0)` (idempotent) or drop duplicate |
| `src/core/data/WsClient.spec.ts` | If tests mock store, expect count clear |

#### Implementation steps

1. Update `clearEntities` implementation + JSDoc: “Removes entities **and** resets layer entityCount.”
2. Unit test: set entities + count → clearEntities → entities undefined/empty and count 0.
3. Manual: enable maritime, note count, pan across regions with open WS → count hits 0 then climbs with new frames.

#### Risks

- Components assuming count survives entity clear: none expected; count is a display of entities.
- `getAllEntities()` already ignores missing keys; no change.

---

### 4.4 Problem 6 — Zoomed-out behavior contradicts itself

#### Symptom
- HUD (`AppShell`): “Zoom in to view live shipping activity” when `currentViewport === null`.
- `WsClient.updateSubscriptionForEngine`: when `viewport` is null, subscribes to **Strait of Malacca** hardcode `[[[1.0, 101.0], [6.0, 104.0]]]`.

User zoomed out over the Atlantic can still see Singapore-area ships (if feed has them) while being told there is no live activity.

#### Product decision (must pick one)

| Option | Behavior when zoomed out (`currentViewport === null`) | HUD | Trust impact |
|--------|------------------------------------------------------|-----|--------------|
| **A — Honest empty (recommended)** | Do **not** send a fallback box; send `boundingBoxes: []` **or** skip subscribe update and clear entities once | Keep “Zoom in…” | High — UI matches data |
| **B — Honest fallback** | Keep Malacca (or a named “world sample”) subscription | Change HUD to “Zoomed out — showing sample traffic (Malacca Strait). Zoom in for local live traffic.” | Medium — truthful sample |
| **C — Global sample** | Subscribe global (only if engine/seeder can afford it) | “Showing global sample — zoom in to focus” | Low for free-tier bandwidth |

**Recommendation: Option A** for data-quality trust. Sample traffic in the wrong hemisphere teaches users the product is “random.”

#### Do / Don’t (safe fix)

| Do | Don’t |
|----|-------|
| **Probe engine first:** what does `boundingBoxes: []` mean (no ships vs global)? | Assume empty boxes mean “show nothing” without a captured frame/test |
| If empty === global → **send no subscribe** on null viewport; only clear local entities | Ship `boxes = []` blindly and accidentally subscribe global |
| Leave non-null viewport + antimeridian split code paths untouched | Refactor the whole box builder while changing null behavior |
| Keep HUD in sync with the chosen option (A keeps current HUD; B/C rewrite copy) | Delete Malacca fallback while HUD still implies a sample, or vice versa |
| Document the chosen engine contract in a code comment + unit test | Rely on tribal knowledge for empty-box semantics |

#### Files to touch

| File | Change |
|------|--------|
| `src/core/data/WsClient.ts` | Null viewport branch per Option A/B |
| `src/components/layout/AppShell.tsx` | HUD copy only if Option B/C |
| `src/core/data/WsClient.spec.ts` | Assert boxes for null viewport |
| `src/app/globals.css` | No change unless HUD structure changes |

#### Implementation steps (Option A)

1. Replace Malacca fallback:

```ts
if (!viewport) {
  boxes = []; // explicit empty scope
}
```

2. Still call `clearEntities` when transitioning from a real viewport → null so old ships leave.
3. Keep HUD as-is.
4. On zoom-in, existing debounced viewport path re-subscribes with real boxes.
5. Tests:
   - `viewport = null` → payload `boundingBoxes: []` (or documented skip)
   - transition real → null → `clearEntities` invoked
   - non-null viewport unchanged (incl. antimeridian split)

#### Note on engine semantics
If the engine treats `boundingBoxes: []` as “no filter / global,” Option A is unsafe — verify with `local-scripts/verify-maritime-subscription.mjs` or engine docs before shipping. Fallback if empty means global: **do not send a subscribe frame on null viewport**; only clear local entities and wait for zoom-in.

Add an explicit code comment + test documenting the chosen engine contract.

---

### 4.5 Problem 9 — Seeder per-message raw logging

#### Symptom
Under dense AIS traffic, seeder logs megabytes of JSON per minute:

```js
console.log("[Maritime Raw AISStream] -> ", JSON.stringify(msg, null, 2));
```

This competes with the event loop used for buffer flush + Redis snapshot, increasing latency and risk of watchdog reconnects (30s silence timer can fire if the process is busy logging).

#### Design decision

- Default: **no per-message body logs**.
- Opt-in: `MARITIME_DEBUG_AIS=1` (or `DEBUG=maritime:ais`) enables sampled or full raw logs.
- Keep milestone logs: connect, subscribe, reconnect, flush errors, snapshot size (already present).

#### Do / Don’t (safe fix)

| Do | Don’t |
|----|-------|
| Gate raw per-message logs behind env | Strip connect/error/snapshot milestone logs |
| Edit + commit in the **nested** seeder repo; rebuild; restart only that service | Bundle seeder shape/TTL/entry-point changes into the same PR as frontend |
| Prefer single-line JSON even in debug | Leave `JSON.stringify(msg, null, 2)` on the hot path |
| Document `MARITIME_DEBUG_AIS` in seeder env/README | Change Redis key layout or snapshot payload while “just fixing logs” |

| File | Change |
|------|--------|
| `local-seeders/community/maritime/src/**` (source, if present) **or** `dist/index.mjs` if source is not in tree | Gate raw log |
| Seeder README / env example | Document `MARITIME_DEBUG_AIS` |

Note: `local-seeders/community/maritime` is a **nested git repo**. Commit lands in that repo’s remote, not worldwideview. Coordinate version bump on the seeder package if the engine pins versions.

#### Implementation steps

1. Locate TypeScript source (`src/index.ts`); if only `dist/index.mjs` exists in the clone, patch source upstream or rebuild after edit.
2. Replace raw log:

```js
if (process.env.MARITIME_DEBUG_AIS === "1") {
  console.log("[Maritime Raw AISStream] ->", JSON.stringify(msg));
}
```

Prefer single-line JSON (no `null, 2`) even in debug to reduce volume.

3. Optional: log aggregate every flush — `buffered=${batch.length} fleet=${activeFleetCache.size}`.
4. Rebuild seeder; restart docker compose maritime/seeder service.
5. Confirm default runs no longer spam raw frames.

---

## 5. Implementation order

Work in this order so each step is testable without depending on later ones. **Do not skip the per-phase regression gate.**

```text
Phase 0  Prep
  └─ Branch, confirm maritime plugin ID constant usage, run existing WsClient tests

Phase 1  Problem 2 — payload mapper          [blocks empty globe]
  ├─ mapMaritimePayload.ts + tests
  ├─ WsClient.handleDataMessage integration (plugin mapper still first)
  └─ GATE: array path + mapWebsocketPayload override tests green

Phase 2  Problem 5 — clearEntities count     [small, unblocks clean asserts]
  ├─ dataSlice + tests
  └─ GATE: layerActivation disable still correct; selection refresh unchanged

Phase 3  Problem 3 — cache policy            [stops stale trust breakers]
  ├─ LIVE_EPHEMERAL_PLUGIN_IDS
  ├─ PluginManager enable/handleDataUpdate (maritime only)
  ├─ invalidate on viewport clear + boot
  └─ GATE: non-maritime PluginManager IDB hydrate tests still green

Phase 4  Problem 6 — zoom-out honesty        [UX/data alignment]
  ├─ REQUIRED: verify engine empty-box semantics before coding
  ├─ If empty === global → no subscribe frame on null viewport (not boxes=[])
  ├─ WsClient null viewport + tests (+ HUD if B/C)
  └─ GATE: antimeridian + skip-clear-when-not-OPEN tests green

Phase 5  Problem 9 — seeder log noise        [ops; nested repo]
  ├─ Gate raw AIS logs only; rebuild; restart seeder service
  └─ GATE: seeder still snapshots + reconnects; no shape/TTL change

Phase 6  Verification gate
  └─ Full unit + manual checklist (§6)
```

### Why this order avoids regressions

1. **Mapper (2) first** — ships can appear at all; later UI/cache work is testable against real entities.
2. **Count (5) second** — small store fix; pan/clear asserts become trustworthy before cache work.
3. **Ephemeral cache (3) third** — stops stale flash without touching payload parsing.
4. **Zoom-out (6) fourth** — needs an engine probe; isolated from cache/mapper.
5. **Seeder logs (9) last** — nested repo; zero frontend coupling; restart only seeder.

Estimated effort (one engineer familiar with the repo):

| Phase | Effort |
|-------|--------|
| 1 | 2–4 h |
| 2 | 0.5–1 h |
| 3 | 2–3 h |
| 4 | 1–2 h (+ engine check) |
| 5 | 0.5–1 h |
| 6 | 1–2 h |
| **Total** | **~1–1.5 days** |

---

## 5b. Deferred problems — safe approaches if touched later

These stay **out of the implementation phases above**. If a later PR addresses them, use the safe approach only.

| # | User-visible effect if left unfixed | Safe approach later | Breaks if you… |
|---|-------------------------------------|---------------------|----------------|
| **4** | During fast pan, old-region ships can flash back for a frame after clear (stale `setTimeout(0)` callback) | Generation/seq counter per `pluginId`: ignore callbacks whose seq &lt; current | Remove all DataBus `setTimeout(0)` → risk React “max update depth” on boot |
| **7** | Ghost ships sit on the globe up to 6h after AIS went dark | Shorten `activeFleetCache` TTL in seeder only; optional client max-age filter on mapped entities | Wipe Redis key semantics or the 6h history SQLite path by accident |
| **8** | Maritime seeder fails to start when something resolves `package.json` `"main"` | Point `"main"` at `dist/index.mjs` **or** dual-emit `seeder.mjs` + `index.mjs` in tsup; update engine/compose mount in the **same** change | Rename entry without updating the engine mount path |
| **10** | Team debugs the wrong layer; demos promise “pan hydrates region” while local seeder ignores boxes | Update RCA + dynamic-AIS plan to state: local seeder = global AISStream box; client boxes are cloud/engine-dependent | Promise pan-hydration in product copy while seeder still ignores `boundingBoxes` |
| **1** | Client viewport boxes do not change local AIS scope | Engine/seeder contract plan (not this file): honor subscribe boxes or document that only cloud does | Clear local entities on pan while engine never re-sends → permanent empty globe |

---

## 6. Testing plan

### 6.1 Automated

```bash
pnpm test src/core/data/mapMaritimePayload.test.ts
pnpm test src/core/data/WsClient.spec.ts
pnpm test src/core/data/WsClient.test.ts
pnpm test src/core/state/dataSlice.test.ts
# PluginManager tests if present / add focused cases
pnpm test
```

New cases checklist:

- [ ] Maritime object payload → N entities on DataBus
- [ ] Maritime array payload still works
- [ ] Invalid coordinates skipped
- [ ] `clearEntities` zeros `entityCount`
- [ ] `enablePlugin("maritime")` does not emit IDB entities
- [ ] Viewport update invalidates cache (mock `cacheLayer.invalidate`)
- [ ] Null viewport: no Malacca box (Option A) / expected copy (Option B)

### 6.2 Manual (local docker)

Prerequisites: `pnpm dev:all` or equivalent; `AISSTREAM_API_KEY` set; maritime layer available.

| Step | Action | Expected after fix |
|------|--------|--------------------|
| M1 | Enable maritime zoomed into a covered chokepoint (e.g. Singapore / English Channel) | Ships appear within ~flush interval (5s+) without console ignore-warning |
| M2 | Open DevTools → Application → IndexedDB `worldwideview-cache` | After using maritime, either no `maritime` key or memory-only (no durable stale fleet) |
| M3 | Pan to a distant region | Ships clear promptly; layer count → 0 then refills; no flash of old region after 1s |
| M4 | Disable maritime, re-enable | No multi-second flash of previous fleet from cache; loading then live |
| M5 | Zoom out past viewport gate | HUD visible; **no** Singapore ships if user is over empty ocean (Option A) |
| M6 | Seeder logs (`docker compose logs -f` seeder) | No per-message AIS JSON spam at default env |

### 6.3 Regression guards (must stay green)

| Guard | Protects |
|-------|----------|
| Antimeridian split tests | Non-null viewport box builder |
| Skip-clear-when-socket-not-OPEN | No blank globe mid-reconnect |
| Non-maritime plugins still IDB-hydrate on enable | Aviation/static instant paint |
| `mapWebsocketPayload` override still called first | Future/rich maritime plugin |
| Array-shaped maritime payload still renders | Cloud engine shape variance |
| `layerActivation` disable still clears entities + count + hover/selection | Layer panel off path |
| DataBus `setTimeout(0)` deferrals left in place | Boot “max update depth” |
| Seeder still writes Redis snapshot + reconnects after log gate | Live pipeline health |

### 6.4 Per-phase command gate

After **every** phase:

```bash
pnpm test src/core/data/WsClient.spec.ts \
          src/core/data/WsClient.test.ts \
          src/core/state/dataSlice.test.ts \
          src/core/plugins/PluginManager.test.ts \
          src/core/data/CacheLayer.test.ts
# plus any new files from that phase
```

Manual spot-check after Phases 1, 3, 4:

1. Enable a **non-maritime** cached layer → still paints from cache quickly.
2. Enable maritime → ships only from live path (after Phase 3: no stale flash).
3. Pan with open WS → clear then refill; count tracks globe.

---

## 7. Rollout and feature flags

No feature flag required for Problems 2, 5, 9 (correctness/perf).  

Problem 3 (skip cache) slightly changes enable UX (brief empty state). Acceptable; optional env:

```bash
NEXT_PUBLIC_MARITIME_ALLOW_IDB_CACHE=false  # default false after fix
```

only if we need an emergency revert. Prefer shipping hard correct behavior — do **not** default this on for maritime in production.

Problem 6 may need a short product ack on Option A vs B before merge. **Block Phase 4 merge** until empty-`boundingBoxes` semantics are verified (or the “no subscribe on null viewport” fallback is coded and tested).

Nested seeder change (Problem 9): deploy seeder image/restart independently of Next app. Never require a frontend redeploy to pick up log gating.

---

## 8. Commit strategy

Follow repo `/commit` workflow (semver bump + conventional commits). Suggested split:

1. `fix(data): map maritime fleet object payloads to GeoEntity[]`
2. `fix(state): reset entityCount inside clearEntities`
3. `fix(plugins): skip IndexedDB rehydrate for live maritime`
4. `fix(ws): align zoomed-out maritime subscribe with HUD`
5. Seeder repo: `perf(maritime): gate raw AISStream message logging`

Do not bundle unrelated uncommitted viewport work without review — this plan assumes those files may already be dirty; rebase/stack carefully.

---

## 9. Open questions (resolve during Phase 4 / 1)

1. **Cloud engine payload shape today** — array or MMSI dict? Mapper must handle both (planned). Confirm with one captured WS frame from staging.
2. **Empty `boundingBoxes` semantics** on cloud + local engine — filter-all vs filter-none? **Phase 4 blocker.**
3. **Is a maritime frontend plugin shipping soon?** If yes, keep core mapper as **fallback forever** until the plugin is guaranteed installed for every edition (`local` / `cloud` / `demo`); do not delete the core path early.
4. **Option A vs B** for zoom-out — product call (default plan: A, with no-subscribe fallback if empty boxes mean global).
5. **Any non-maritime caller depend on `entityCount` surviving `clearEntities`?** Expected: no. Confirm via ripgrep before Phase 2 merge.

---

## 10. Appendix — code anchors (pre-change)

```ts
// WsClient.handleDataMessage — drop path (Problem 2)
} else if (!Array.isArray(data.payload)) {
  console.warn(`[WsClient] Payload for ${pluginId} is an object but no mapWebsocketPayload exists. Ignoring.`);
  return;
}
```

```ts
// WsClient — Malacca fallback (Problem 6)
if (!viewport) {
  boxes = [[[1.0, 101.0], [6.0, 104.0]]];
}
```

```ts
// WsClient — clear without cache invalidate / count (Problems 3 & 5)
useStore.getState().clearEntities(MARITIME_PLUGIN_ID);
```

```ts
// configSlice — 1h TTL (Problem 3)
cacheMaxAge: 3600000,
```

```ts
// PluginManager.enablePlugin — IDB hydrate (Problem 3)
let cached = cacheLayer.get(pluginId);
if (!cached) {
  cached = await cacheLayer.getFromPersistent(pluginId);
}
if (cached && managed.enabled) {
  dataBus.emit("dataUpdated", { pluginId, entities: cached });
}
```

```js
// seeder — object snapshot (Problem 2) + raw log (Problem 9)
await setLiveSnapshot("maritime", Object.fromEntries(activeFleetCache), 6 * 3600);
console.log("[Maritime Raw AISStream] -> ", JSON.stringify(msg, null, 2));
```

---

## 11. Analogy (for reviewers)

The globe is a live departure board.

- **Problem 2** is the station receiving train data as a dictionary but only knowing how to read a list — so the board stays blank even when trains exist.
- **Problem 3** is taping yesterday’s printed schedule back up every time someone turns the board on.
- **Problem 5** is the “trains in station: 40” sign not resetting when the board is wiped.
- **Problem 6** is a sign saying “zoom to your station for live trains” while the board still shows Singapore because that was a convenient default.
- **Problem 9** is the back-office printer dumping a full novel for every radio blip so clerks can’t process the next blip on time.

Safe-fix version of the same analogy: rewire **only the maritime track’s** reader, memory, counter, and sign — leave the aviation/static tracks on the old working circuit. Probe the switchyard (engine) before changing what “no destination filter” means.

This plan fixes the board’s reading, memory, counters, signage, and printer noise — so users can trust what they see — without blacking out the rest of the station.
