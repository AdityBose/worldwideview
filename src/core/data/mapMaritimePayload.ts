/**
 * @file mapMaritimePayload.ts
 * @description Converts maritime seeder fleet snapshots (MMSI → ship state dict)
 * into GeoEntity[]. Used as a core fallback when no plugin mapWebsocketPayload exists.
 */

import type { GeoEntity } from "@worldwideview/wwv-plugin-sdk";
import { MARITIME_PLUGIN_ID } from "@/core/plugins/pluginIds";

type LooseShip = Record<string, unknown>;

function asFiniteNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    return null;
}

function readCoord(ship: LooseShip, primary: string, fallback: string): number | null {
    const a = asFiniteNumber(ship[primary]);
    if (a !== null) return a;
    return asFiniteNumber(ship[fallback]);
}

function isPlainObject(value: unknown): value is LooseShip {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Map a maritime fleet object payload into GeoEntity[].
 *
 * @returns `GeoEntity[]` when payload is a plain object (possibly empty).
 * @returns `null` when payload is not a fleet object (arrays, null, primitives)
 *          so the caller can keep the existing array / ignore paths.
 */
export function mapMaritimeFleetPayload(payload: unknown): GeoEntity[] | null {
    if (!isPlainObject(payload)) return null;

    const entities: GeoEntity[] = [];

    for (const [key, raw] of Object.entries(payload)) {
        if (!isPlainObject(raw)) continue;

        const lat = readCoord(raw, "lat", "latitude");
        const lon = readCoord(raw, "lon", "longitude");
        if (lat === null || lon === null) continue;
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

        const mmsiRaw = raw.mmsi ?? key;
        const mmsi = String(mmsiRaw);
        const id =
            typeof raw.id === "string" && raw.id.length > 0
                ? raw.id
                : `mmsi-${mmsi}`;

        const hdg = asFiniteNumber(raw.hdg ?? raw.heading);
        const spd = asFiniteNumber(raw.spd ?? raw.speed);
        const lastUpdated = asFiniteNumber(raw.last_updated ?? raw.lastUpdated);
        const name =
            typeof raw.name === "string" && raw.name.trim().length > 0
                ? raw.name.trim()
                : undefined;

        const heading =
            hdg !== null && hdg >= 0 && hdg < 360 ? hdg : undefined;

        const timestampMs =
            lastUpdated !== null
                ? lastUpdated > 1e12
                    ? lastUpdated // already ms
                    : lastUpdated * 1000
                : Date.now();

        // ECMAScript Date valid time-value range is roughly ±1e8 days from epoch.
        const timestamp =
            Number.isFinite(timestampMs) && Math.abs(timestampMs) <= 8.64e15
                ? new Date(timestampMs)
                : new Date();

        entities.push({
            id,
            pluginId: MARITIME_PLUGIN_ID,
            latitude: lat,
            longitude: lon,
            altitude: 0,
            heading,
            speed: spd ?? undefined,
            timestamp,
            label: name ?? `MMSI ${mmsi}`,
            properties: {
                ...raw,
                mmsi, // normalized string wins over numeric upstream mmsi
            },
        });
    }

    return entities;
}
