# Root Cause Analysis: Maritime Data Hydration Gaps & Environmental Blocks

> **Last Updated:** 2026-07-19 — Updated with live validation results from local `wwv-data-engine` run, Redis snapshot query, and maritime seeder source code audit.

This document provides a highly detailed, senior-engineer level Root Cause Analysis (RCA) explaining why maritime data successfully hydrates in specific regions (such as the Mediterranean and Baltic) while remaining completely blind in others (such as the Arabian Sea and the entire Indian coastline). It also documents the Docker environment freeze root cause and its fix.

---

## Executive Summary

The core frontend viewport subscription wiring, camera sync hooks, and UI overlays are largely structurally sound and covered by unit tests.

**Two separate issue classes must not be collapsed:**

1. **Coverage / provider class (this RCA’s primary observation):** For the 2026-07-19 live run, the observed Indian-ocean / Arabian Sea emptiness in a *global* AISStream subscription is best explained as **provider coverage at that sample time**, not as “the browser failed to map a full fleet.” That does **not** prove no Indian-coast receivers ever exist.
2. **Software correctness class (tracked separately):** Independent of coverage, the client/seeder stack has confirmed product defects documented in `IMPLEMENTATION_PLAN_MARITIME_DATA_QUALITY.md` — e.g. object fleet payload drops without a mapper, stale IndexedDB maritime rehydrate, `entityCount` not zeroed on clear, and zoom-out / Malacca inconsistency (several of which have since been fixed in the frontend). Those remain real bugs even when AISStream is dense in Europe.

This RCA’s live Redis query confirmed **coverage at sample time** for the Indian box; it does **not** assert “no defects in the local Next.js client or maritime seeder.”

---

## Live Validation Run — 2026-07-19

### Environment
| Component | Status |
|---|---|
| Docker Server | `v29.6.1` ✅ |
| `worldwideview-wwv-redis-1` | Healthy ✅ |
| `worldwideview-wwv-data-engine-1` | Running ✅ |
| `AISSTREAM_API_KEY` | Confirmed present in `.env` and `.env.local` ✅ |

### Maritime Seeder Connection Log (live output)
```
[SeederLoader] Discovered seeder: maritime (maritime)
[Scheduler] Initializing persistent seeder: maritime
[Maritime] Connecting to AisStream.io...
[Maritime] WebSocket connected. Subscribing to global feed...
[Redis] Snapshot saved to Redis for maritime (14.79 KB)
```
**Result:** The local engine connected to `wss://stream.aisstream.io/v0/stream` successfully using the user's API key and subscribed to the global feed within seconds of startup.

### Redis Snapshot Query — Indian Ocean Coverage Audit

A Python query was run directly against the live Redis snapshot (`data:maritime:live`) immediately after the first flush (14.79 KB):

```
Total ships in global snapshot:                        407
Ships in Indian waters   (5–25°N, 60–90°E):              0
Ships in Arabian Sea / Mumbai-Goa (8–25°N, 60–78°E):    0
Ships near Chennai (12–14°N, 79–82°E):                   0
```

---

## Detailed Root Cause Analysis (RCA)

### RCA 1: Physical Data Coverage Limits on the Free Tier (AISStream.io)
* **Status:** 🔴 **Coverage observation (single sample window) — not a permanent physical inventory**
* **Validation Method:** Live Redis query against a running local engine with a valid `AISSTREAM_API_KEY`.
* **The Mechanics:** `AISStream.io` is a community-driven AIS transponder network. It relies on volunteer-run, land-based **RTL-SDR (Software Defined Radio) receivers** hosted by enthusiasts who capture local VHF radio pings from passing ships and upload them to the AISStream database.
* **The Empirical Observation (Live Run — single window):**
  * The local engine subscribed to the **entire globe** (`BoundingBoxes: [[[-90,-180],[90,180]]]`) using the user's own API key.
  * The first Redis snapshot contained **407 ships** — concentrated in data-rich regions (North Sea, Mediterranean, Baltic, English Channel, Singapore Strait).
  * **0 ships** were present in that snapshot for Indian waters (lat 5–25°N, lon 60–90°E), including the Arabian Sea sample box and the Port of Chennai box.
* **What this does *not* prove:** A single zero-result snapshot does **not** establish that no Indian-coast AIS receivers exist in the AISStream volunteer network, nor that coverage is permanently absent. It only shows **no ships in those boxes at that flush time**. Treat “no Western/Eastern Indian coastline stations” as a **hypothesis**, not a confirmed physical-layer inventory.
* **Required before calling this a permanent physical blocker:** repeated samples across time-of-day/week, comparison with another AIS provider or paid tier for the same boxes, and confirmation the seeder is still connected (not mid-reconnect / empty cache).
* **Previous claim correction:** Earlier “8 Chennai vessels” from a cloud path may have been historical cache, not proof of continuous live coastal feed. Coverage in Tamil Nadu appears **intermittent at best** from the samples we have — still an observation, not a station census.
* **Software defects remain separate:** Even with dense European coverage, payload-shape drops, stale IDB rehydrate, and zoom-out paint honesty bugs can still empty or mislead the globe. See `IMPLEMENTATION_PLAN_MARITIME_DATA_QUALITY.md`.

---

### RCA 2: Local Engine Uses Global Subscription — Cloud Caching Remains Irrelevant for Local Dev
* **Status:** 🟡 **Partially Invalidated for Local Deployment**
* **Original Claim:** The production cloud engine ignores client-side `boundingBoxes` payloads to prevent AISStream key lockout, serving a static European/Singapore snapshot instead.
* **Source Code Audit Finding:** The local maritime seeder (`local-seeders/community/maritime/dist/index.mjs`, line 304) uses a **full-globe subscription** on open:
  ```js
  BoundingBoxes: [[[-90, -180], [90, 180]]],
  FilterMessageTypes: ["PositionReport"]
  ```
  This means the local engine does **not** depend on the frontend's dynamic viewport bounding boxes at all — it requests all globally available ships at once and stores them in Redis. The Dynamic Viewport Hydration feature (Steps 1–4) therefore provides **bandwidth efficiency and UX clarity** rather than being required for data access on a local setup.
* **Cloud Engine Claim Stands:** The cloud fallback (`wss://dataenginev2.worldwideview.dev/stream`) still ignores per-client `boundingBoxes` for the multi-tenancy reasons documented originally. Users relying on the cloud fallback without a local engine cannot use dynamic subscriptions.
* **Net Impact for This Setup:** RCA 2 is not a blocker. The local engine is self-sufficient.

---

### RCA 3: Local Data Engine Docker VirtioFS Freeze — Fixed
* **Status:** ✅ **Root Cause Identified and Fixed**
* **The Root Cause:** When `pnpm install` runs inside the `wwv-data-engine` container, it writes `node_modules` into the `./local-seeders` host-mounted volume. On macOS, Docker Desktop syncs this directory through a VirtioFS/gRPC-FUSE layer. Syncing thousands of tiny `node_modules` files over this layer created an intense I/O bottleneck that froze the macOS Docker Desktop daemon.
* **The Fix Applied:** [`docker-compose.yml`](./docker-compose.yml) was updated to add two named Docker volumes that **shadow** the `node_modules` directories inside the container:
  ```yaml
  volumes:
    - ./local-seeders:/app/seeders
    # RCA-3 fix: shadow node_modules with named volumes
    - seeders-community-node-modules:/app/seeders/community/node_modules
    - seeders-private-node-modules:/app/seeders/private/node_modules
  ```
  And declared at the bottom of the compose file:
  ```yaml
  volumes:
    seeders-community-node-modules:
    seeders-private-node-modules:
  ```
  **How it works:** Named Docker volumes live entirely inside Docker's Linux VM. When `pnpm install` writes `node_modules`, it writes into the VM's own storage — the macOS host filesystem never sees those files, eliminating the VirtioFS bottleneck.

---

### RCA 4: Codebase Verification & Structural Soundness
* **Status:** ✅ **Frontend unit suite healthy at time of original write — software defects tracked separately**
* Frontend changes (Steps 1–4 of the Dynamic Viewport Hydration plan) compile cleanly, pass linting, and pass all 16 Vitest unit tests with `exit code 0`.

---

## Recommended Action Plan

| Priority | Action | Resolves |
|---|---|---|
| ✅ Done | Apply Docker VirtioFS fix to `docker-compose.yml` | RCA 3 |
| ✅ Done | Run local `wwv-data-engine` with own `AISSTREAM_API_KEY` | RCA 2 (local) |
| Observation | Indian-box emptiness in the 2026-07-19 sample is a **coverage observation**; re-validate before treating as permanent. Software quality fixes remain independent (`IMPLEMENTATION_PLAN_MARITIME_DATA_QUALITY.md`). | RCA 1 + data-quality plan |
| 💡 Optional | Upgrade to a commercial satellite AIS provider (Spire, Orbcomm, MarineTraffic API) for full Indian Ocean coverage | RCA 1 |
| 💡 Optional | Set up a local RTL-SDR receiver on the Western Indian Coast to contribute to the AISStream volunteer network | RCA 1 |

---

*Prepared by WorldWideView Engineering Team. Updated 2026-07-19 with live validation results.*

*Clarified 2026-07-24: separate coverage observations from software defects; single-snapshot non-inference.*
