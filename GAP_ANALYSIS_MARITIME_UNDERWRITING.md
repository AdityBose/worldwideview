# Product Gap Analysis & Strategic Roadmap: WorldWideView for SMB Maritime Underwriters

**Date:** 2026-07-23  
**Target Market:** SMB Maritime Cargo Insurance Underwriters, Boutique Lloyd's Syndicates, and Regional P&I Clubs ($5M–$50M Gross Written Premium).  
**Target Value Proposition:** A lightweight, local-first, zero-database-migration spatial risk canvas that consolidates live vessel positions, insured policy portfolios, and geopolitical hazard zones into instant underwriting clarity.

---

## 1. Executive Summary

WorldWideView (WWV) possesses a powerful foundation: a Next.js 16 + CesiumJS 3D geospatial engine driven by Zustand state slices, a decoupled WebSocket `DataBus`, and a modular plugin architecture (`@worldwideview/wwv-plugin-sdk`).

However, while WWV excels as a general-purpose geospatial 3D viewer, **it currently lacks the domain-specific data connectors, spatial intersection tools, and local-first policy matching features** necessary to solve the SMB Underwriter problem.

This document bridges the current code state with the mid-2026 market positioning strategy, outlining:
1. What the codebase currently supports.
2. Where the project is technically lacking for SMB underwriters.
3. The exact feature requirements needed to achieve zero-friction commercial adoption.

---

## 2. Current Code Base Capabilities vs. Underwriter Requirements

| Underwriter Strategic Need | WWV Codebase Status | Technical Reality in Code |
|---|---|---|
| **A. Insured Portfolio Import (CSV/IMO)** | ❌ **Missing** | No user-facing UI or parser to upload a CSV/Excel file of insured IMO/MMSI numbers or match them against map entities. |
| **B. Spatial Risk Accumulation & Geofencing** | ⚠️ **Partial (Read-only)** | Can render static GeoJSON boundaries via [plugin.json](src/plugins/geojson/plugin.json), but lacks interactive polygon drawing or real-time point-in-polygon counting. |
| **C. Joint War Committee & Sanctions Layers** | ⚠️ **Partial** | Has ACLED conflict events and OpenStreetMap border boundaries, but lacks dedicated Joint War Committee (JWC) Hull War Listed Areas and OFAC maritime sanctions zones. |
| **D. Live Maritime Ingestion Reliability** | ⚠️ **Work in Progress** | Local seeder ingests AISStream transponders ([index.mjs](local-seeders/community/maritime/dist/index.mjs)), but free-tier AIS has ocean coverage gaps and browser caching/mapping fixes are pending ([IMPLEMENTATION_PLAN_MARITIME_DATA_QUALITY.md](IMPLEMENTATION_PLAN_MARITIME_DATA_QUALITY.md)). |
| **E. Severe Weather & Storm Track Overlays** | ⚠️ **Partial** | Supports OpenWeatherMap tile overlays ([weatherLayers.ts](src/lib/weatherLayers.ts)), but lacks NOAA vector storm tracks, hurricane cones, and wind vector overlays. |
| **F. Local-First Privacy & Zero-Retention Security** | ✅ **Strong Foundation** | Local edition architecture ([edition.ts](src/core/edition.ts)) keeps app execution client-side; memory-only policy parsing can be easily added without remote server storage. |

---

## 3. Deep-Dive Gap Analysis: What Is Lacking

### Gap 1: Insured Fleet Matching & Policy Portfolio Ingestion (High Priority)
* **The Goal:** Underwriters need to drop a spreadsheet (containing columns like `IMO`, `MMSI`, `Vessel Name`, `Insured Value ($USD)`, `Policy Expire Date`) onto the app and instantly highlight those specific vessels on the globe in bright gold/red.
* **Where Code Lacks Today:**
  * No component in `src/components/panels/` or `src/plugins/` accepts tabular formats (`.csv`, `.xlsx`).
  * The Zustand store ([dataSlice.ts](src/core/state/dataSlice.ts)) treats all entities homogeneously per plugin. There is no concept of a "User Insured Watchlist" or conditional entity highlighting based on user-supplied identifiers.
  * Cesium primitive styling ([useEntityRendering.ts](src/core/globe/hooks/useEntityRendering.ts)) applies fixed icons and colors per layer rather than dynamic entity property overrides (e.g., halo glow for insured ships).

### Gap 2: Spatial Risk Accumulation & Interactive Geofencing (High Priority)
* **The Goal:** An underwriter seeing a new blockade or conflict zone (e.g., Strait of Hormuz, Bab-el-Mandeb, Black Sea) needs to:
  1. Sketch a custom hazard polygon directly on the 3D globe.
  2. Instantly calculate: **"How many total vessels and how much total insured GWP/cargo value are inside this box right now?"**
  3. Receive visual/audio alerts when an insured vessel crosses into that box.
* **Where Code Lacks Today:**
  * [useCameraSync.ts](src/core/globe/hooks/useCameraSync.ts) computes view rectangles for camera sync, but there is no user drawing mode on `GlobeView.tsx` (using Cesium `ScreenSpaceEventHandler`) to create custom polygons.
  * No Point-in-Polygon (PIP) spatial query utility (e.g. `@turf/boolean-point-in-polygon`) integrated into the Zustand store to compute real-time spatial intersections.
  * No accumulation HUD panel showing aggregated insured values inside visible or drawn polygons.

### Gap 3: War-Risk, Sanctions & Geopolitical Hazard Layers (Medium Priority)
* **The Goal:** Out-of-the-box feeds for London Joint War Committee (JWC) Listed Areas, OFAC High-Risk Waters, and Houthi/Somali pirate threat zones.
* **Where Code Lacks Today:**
  * Current layers focus on natural hazards (`earthquakes`, `wildfires`, `volcanoes`) and general conflict events (`ACLED` points).
  * Missing vector GeoJSON polygons representing formal marine insurance war-risk zones (JWC JWLA-032 boundaries).

### Gap 4: Commercial AIS Data Adapter Support (High Priority)
* **The Goal:** Free-tier `AISStream.io` data relies on volunteer shore antennas, leaving deep-sea ocean routes and parts of the Arabian Sea blind. SMB underwriters need option to plug in commercial satellite AIS keys (Spire, Orbcomm, VesselFinder, or MarineTraffic API).
* **Where Code Lacks Today:**
  * The local maritime seeder ([dist/index.mjs](local-seeders/community/maritime/dist/index.mjs)) is hardcoded to `wss://stream.aisstream.io/v0/stream`.
  * There is no provider-agnostic seeder adapter interface allowing underwriters to input an API key for commercial providers like Spire, VesselFinder, or custom REST/WS telemetry endpoints.

### Gap 5: Ephemeral Local-First Privacy Model for Policy Data (Medium Priority)
* **The Goal:** Underwriters must be 100% guaranteed that their policy spreadsheets and insured vessel lists **never get uploaded** to any cloud server or database.
* **Where Code Lacks Today:**
  * The app supports local edition modes ([edition.ts](src/core/edition.ts)), but there is no explicit `LocalMemoryOnlyStorage` module explicitly documented and enforced for portfolio uploads.

---

## 4. Technical Requirements & Implementation Roadmap

To transform WorldWideView into the premier Underwriter Situational Risk Canvas, the following 4-phase technical roadmap must be executed:

```
[Phase 1: Foundation Fixes] ──► [Phase 2: Portfolio Drop] ──► [Phase 3: Spatial Risk] ──► [Phase 4: War & Weather]
(Payload & Ephemeral Cache)    (CSV Upload & IMO Match)      (Draw Polygon & Accumulation) (JWC & NOAA Vectors)
```

---

### Phase 1: Core Maritime Data Quality & Ingestion Stabilization
*Execute the pending technical fixes in [IMPLEMENTATION_PLAN_MARITIME_DATA_QUALITY.md](IMPLEMENTATION_PLAN_MARITIME_DATA_QUALITY.md).*
* **P1.1 Payload Shape Fallback:** Implement `mapMaritimeFleetPayload` in [WsClient.ts](src/core/data/WsClient.ts) so dictionary payloads (`MMSI -> ShipState`) never get dropped when a plugin mapper is absent.
* **P1.2 Ephemeral Cache Policy:** Mark `maritime` as ephemeral in [PluginManager.ts](src/core/plugins/PluginManager.ts) to prevent 1-hour-old IndexedDB cache entries from flashing stale positions onto the globe.
* **P1.3 Count & Viewport Synchronization:** Ensure `clearEntities` in [dataSlice.ts](src/core/state/dataSlice.ts) resets layer `entityCount` to 0 cleanly.

---

### Phase 2: "CSV/Excel Drop" Policy & Portfolio Ingestion Plugin
*Create a native UI panel and parser for underwriting portfolio spreadsheets.*

#### 2.1 File Parser & Store Extension
* **Create `src/components/panels/PolicyUploadPanel.tsx`**: Drag-and-drop file interface accepting `.csv`, `.tsv`, and `.json` policy files.
* **Create `src/core/state/policySlice.ts`**:
  ```typescript
  export interface InsuredVessel {
      imo?: string;
      mmsi?: string;
      vesselName: string;
      insuredValueUSD?: number;
      policyNumber?: string;
      expiryDate?: string;
  }

  export interface PolicySlice {
      insuredVessels: Map<string, InsuredVessel>; // keyed by MMSI or IMO
      loadPolicyCsv: (fileContent: string) => void;
      clearPolicy: () => void;
  }
  ```
* **Client-Only Execution Guarantee:** Parse files entirely in browser memory using Web Workers; never emit policy data over `DataBus` or network fetch calls.

#### 2.2 Dynamic Entity Styling & Underwriter Visual Hierarchy
* **Modify [useEntityRendering.ts](src/core/globe/hooks/useEntityRendering.ts)**:
  * Cross-reference active maritime `GeoEntity.properties.mmsi` or `imo` against `useStore.getState().insuredVessels`.
  * **Insured Vessels:** Render with prominent gold/cyan billboards, pulse animation, and prominent label text showing Vessel Name + Insured Sum (e.g. `MV ARRISCAR ($12.5M)`).
  * **Uninsured Vessels:** Render as muted, semi-transparent background points to maintain situational context without clutter.

---

### Phase 3: Spatial Risk Accumulation & Interactive Geofencing

#### 3.1 Interactive Canvas Drawing Tool
* **Create `src/core/globe/tools/usePolygonDrawer.ts`**:
  * Utilize Cesium `ScreenSpaceEventHandler` to let underwriters click on the globe to draw custom hazard polygons (e.g. custom blockade lines or premium zones).
  * Render drawn polygons with semi-transparent red/orange fills and editable vertices.

#### 3.2 Real-Time Spatial Intersection & Accumulation Engine
* **Create `src/core/spatial/accumulationEngine.ts`**:
  * Leverage Turf.js (`@turf/boolean-point-in-polygon`) to run fast spatial checks when live vessel positions update.
  * **Calculate Exposure Metrics:**
    * Total active vessels in zone.
    * Total **Insured Vessels** in zone.
    * Total **Aggregated Insured Value ($USD)** exposed within the polygon.
* **Create `src/components/hud/SpatialRiskHUD.tsx`**:
  * Floating HUD banner displaying real-time accumulation metrics for the active camera view or drawn polygon:
    > **⚠️ Strait of Hormuz Hazard Zone**  
    > **Total Exposure:** 4 Insured Vessels | **Total Sum Insured:** $48.2M USD

---

### Phase 4: Commercial AIS & War-Risk Hazard Integrations

#### 4.1 Multi-Provider AIS Seeder Adapter
* **Modify `local-seeders/community/maritime/`**:
  * Add configurable REST/WebSocket adapters for commercial AIS APIs (**Spire Maritime**, **VesselFinder**, **MarineTraffic**, or **Orbcomm**).
  * Allow underwriters with commercial API keys to input their key into `.env.local` to stream full satellite AIS (eliminating free-tier ocean blind spots).

#### 4.2 War-Risk & Geopolitical Layer Plugins
* **Create `public/layers/jwc_war_risk_zones.geojson`**:
  * Import official London Joint War Committee (JWC) Listed Areas (JWLA-032).
* **Create `src/plugins/war-risk/`**:
  * Standard data layer plugin providing toggleable overlays for JWC listed areas, High Risk Areas (HRA), and piracy corridors.

---

## 5. Architectural Verification & Definition of Done

To consider the SMB Maritime Underwriting feature set complete, the system must pass the following verification tests:

1. **Zero-Knowledge Privacy Test:**
   * Drop a 5,000-row policy CSV into the app. Inspect Chrome DevTools Network tab. Confirm **0 bytes** of policy data are sent over any HTTP/WebSocket request.
2. **Instant Portfolio Filter Test:**
   * Loading a policy CSV highlights matching vessels on the globe in < 200ms.
3. **Spatial Accumulation Accuracy Test:**
   * Drawing a custom polygon around the Persian Gulf correctly filters live ships, calculates total insured USD value, and updates the HUD within 1 second.
4. **Data Reliability Test:**
   * All 6 manual test cases in [IMPLEMENTATION_PLAN_MARITIME_DATA_QUALITY.md](IMPLEMENTATION_PLAN_MARITIME_DATA_QUALITY.md) pass cleanly without entity dropping or stale cache flashes.

---

*Prepared by WorldWideView Engineering Team.*
