# Implementation Plan: Dynamic Viewport Hydration for Real-Time Maritime Data

## Overview & Objective

This implementation plan outlines the steps to add **Dynamic Viewport Hydration** (Camera-Scoped Subscriptions) to **WorldWideView**.

By dynamically computing the user's visible bounding box in Cesium and updating the active maritime subscription on the fly, we achieve:
1. **Regional focus when zoomed in:** Panning to a coastline sends a viewport-scoped `boundingBoxes` frame to the engine.
2. **Honest zoomed-out UX:** When the view is too wide, the client does not paint maritime entities and does not invent a fake chokepoint box.
3. **Free-tier protection (when the seeder honors boxes):** Smaller boxes reduce AISStream message volume once engine↔seeder demand wiring exists.

---

## Environment Contract (local vs cloud) — read first

| Deployment | Who holds the AIS key | Client `boundingBoxes` today | Live ships when zoomed in |
|---|---|---|---|
| **Local** (`wwv-data-engine` + `local-seeders/community/maritime`) | Host env `AISSTREAM_API_KEY` | Accepted on the WS frame, but the **local seeder currently ignores them** and subscribes globally (`[[[-90,-180],[90,180]]]`) | Yes, if AISStream coverage + key are healthy — filtering is browser-side / future seeder work |
| **Cloud fallback** (`wss://dataenginev2.worldwideview.dev/stream`) | Hosted engine (if configured) | **Not a verified end-to-end contract.** RCA and live checks have shown cloud `maritime` may be null / ignore per-client boxes | **Do not promise** custom Arabian Sea hydration via browser boxes alone |

### What is *not* guaranteed

- **Zero-key cloud multiplexing is not an architectural promise.** Falling back to the hosted engine URL does **not** prove that:
  - the cloud holds a working AIS key,
  - it forwards client `boundingBoxes` to AISStream, or
  - env var names such as `MARITIME_API_KEY` are correct (local seeder uses `AISSTREAM_API_KEY`).
- Treat any “cloud will stream my viewport without a key” claim as an **environment-dependent hypothesis** until the hosted engine contract is confirmed in source or production health.

### Correct env name

- Seeder / compose: `AISSTREAM_API_KEY` (not `MARITIME_API_KEY`).

---

## Architecture & Flow (intended)

```
Cesium camera settle
        │
        ▼
useCameraSync → currentViewport [minLat,minLon,maxLat,maxLon] | null
        │
        ▼
WsClient.updateSubscriptionForEngine
        │
        ├─ viewport null  → subscribe { pluginId: maritime }  (no boxes; no paint)
        └─ viewport set   → subscribe + boundingBoxes (antimeridian-split if needed)
        │
        ▼
data engine  ──(today: local seeder still global)──► AISStream / Redis snapshot
        │
        ▼
browser maps fleet dict → GeoEntity[] (mapMaritimeFleetPayload)
```

Durable **demand-driven AISStream subscription** (engine unions client boxes → seeder `updateDemand`) is a separate engine/seeder change and needs an ADR before implementation.

---

## Frontend behavior (current target — matches code)

### Viewport gate (`useCameraSync`)

- Compute view rectangle when the camera settles.
- If lon/lat span is too wide (>45°), set `currentViewport` to `null` (or preserve last valid box on oblique cameras where Cesium returns no rectangle — do not thrash to null).
- Do **not** invent a Malacca (or any) default box on the client for zoom-out.

### Subscription (`WsClient`)

```typescript
// Zoomed out: register interest only — no fake chokepoint box.
if (!viewport) {
  send({ action: "subscribe", pluginId: "maritime" });
  return;
}

const [minLat, minLon, maxLat, maxLon] = viewport;
// Antimeridian: if minLon > maxLon, split into two boxes.
const boxes =
  minLon > maxLon
    ? [
        [[minLat, minLon], [maxLat, 180]],
        [[minLat, -180], [maxLat, maxLon]],
      ]
    : [[[minLat, minLon], [maxLat, maxLon]]];

send({ action: "subscribe", pluginId: "maritime", boundingBoxes: boxes });
```

### Paint / HUD honesty

| State | Subscribe | Paint ships | HUD |
|---|---|---|---|
| Zoomed out (`currentViewport == null`) | plain maritime subscribe | **No** | “Zoom in to view live shipping activity” |
| Zoomed in with viewport | subscribe + boxes | Yes (when payload arrives) | optional active bbox overlay |
| In-range pan | update boxes; **keep prior fleet** until next snapshot | Yes | — |

Do **not** clear the fleet on every pan; clear on zoom-out / disable as implemented.

---

## Antimeridian regression requirement

Any future change that rebuilds subscription boxes **must** keep the split above. A single `[[minLat,minLon],[maxLat,maxLon]]` box when `minLon > maxLon` inverts or wraps the wrong way around the globe. Add/keep a unit test that crosses ±180°.

---

## Verification Plan

1. **Zoom-out:** `currentViewport` is null (or preserved only for oblique undefined rectangle); no Malacca box; maritime entities not painted; HUD visible.
2. **Zoom-in coast:** viewport set; WS frame includes `boundingBoxes`; ships appear when Redis/live snapshot has coverage (coverage ≠ software defect).
3. **Antimeridian:** viewport with `minLon > maxLon` produces **two** boxes in the subscribe frame.
4. **Pan:** fleet does not empty for a full flush interval solely because boxes updated.
5. **Local vs cloud:** document which engine URL is active; do not fail the test if cloud ignores boxes — that is an environment limit, not a frontend regression.

---

## Related docs

- Software correctness (payload, cache, counts): `IMPLEMENTATION_PLAN_MARITIME_DATA_QUALITY.md`
- Coverage vs hydration RCA: `RCA_MARITIME_DATA_HYDRATION.md`

---

*Updated 2026-07-24 to align with CodeRabbit review and current client behavior.*
