import { describe, it, expect } from "vitest";
import { mapMaritimeFleetPayload } from "./mapMaritimePayload";
import { MARITIME_PLUGIN_ID } from "@/core/plugins/pluginIds";

describe("mapMaritimeFleetPayload", () => {
    it("returns null for arrays (caller keeps array path)", () => {
        expect(mapMaritimeFleetPayload([])).toBeNull();
        expect(mapMaritimeFleetPayload([{ lat: 1, lon: 2 }])).toBeNull();
    });

    it("returns null for null/undefined/primitives", () => {
        expect(mapMaritimeFleetPayload(null)).toBeNull();
        expect(mapMaritimeFleetPayload(undefined)).toBeNull();
        expect(mapMaritimeFleetPayload("x")).toBeNull();
        expect(mapMaritimeFleetPayload(1)).toBeNull();
    });

    it("maps a fleet dict of 3 ships to GeoEntities", () => {
        const payload = {
            "419000001": {
                id: "mmsi-419000001",
                mmsi: "419000001",
                name: "Alpha",
                lat: 1.2,
                lon: 103.8,
                hdg: 90,
                spd: 12.5,
                last_updated: 1_700_000_000,
            },
            "419000002": {
                mmsi: "419000002",
                name: "  Bravo  ",
                lat: 2.1,
                lon: 104.1,
                hdg: 400, // invalid heading → omitted
                spd: 0,
                last_updated: 1_700_000_100,
            },
            "419000003": {
                latitude: 3.0,
                longitude: 105.0,
                name: "Charlie",
            },
        };

        const entities = mapMaritimeFleetPayload(payload);
        expect(entities).not.toBeNull();
        expect(entities!).toHaveLength(3);

        const alpha = entities!.find((e) => e.id === "mmsi-419000001")!;
        expect(alpha.pluginId).toBe(MARITIME_PLUGIN_ID);
        expect(alpha.latitude).toBe(1.2);
        expect(alpha.longitude).toBe(103.8);
        expect(alpha.heading).toBe(90);
        expect(alpha.speed).toBe(12.5);
        expect(alpha.label).toBe("Alpha");
        expect(alpha.properties.mmsi).toBe("419000001");
        expect(alpha.timestamp).toEqual(new Date(1_700_000_000 * 1000));

        const bravo = entities!.find((e) => e.id === "mmsi-419000002")!;
        expect(bravo.label).toBe("Bravo");
        expect(bravo.heading).toBeUndefined();

        const charlie = entities!.find((e) => e.id === "mmsi-419000003")!;
        expect(charlie.latitude).toBe(3.0);
        expect(charlie.longitude).toBe(105.0);
        expect(charlie.label).toBe("Charlie");
    });

    it("returns empty array for empty dict (live clear, not drop)", () => {
        expect(mapMaritimeFleetPayload({})).toEqual([]);
    });

    it("skips invalid coordinates and non-object values", () => {
        const payload = {
            badLat: { mmsi: "1", lat: 99, lon: 10 },
            badLon: { mmsi: "2", lat: 10, lon: 200 },
            missing: { mmsi: "3", name: "no coords" },
            notObj: "skip-me",
            good: { mmsi: "4", lat: 10, lon: 20, name: "Ok" },
        };

        const entities = mapMaritimeFleetPayload(payload);
        expect(entities).toHaveLength(1);
        expect(entities![0].id).toBe("mmsi-4");
        expect(entities![0].label).toBe("Ok");
    });

    it("accepts latitude/longitude aliases and keeps normalized string mmsi", () => {
        const payload = {
            "419000099": {
                mmsi: 419000099,
                latitude: 12.5,
                longitude: 77.25,
                name: "Alias Ship",
            },
        };

        const entities = mapMaritimeFleetPayload(payload);
        expect(entities).toHaveLength(1);
        expect(entities![0].latitude).toBe(12.5);
        expect(entities![0].longitude).toBe(77.25);
        expect(entities![0].properties.mmsi).toBe("419000099");
    });

    it("falls back to a valid Date when last_updated is out of range", () => {
        const before = Date.now();
        const payload = {
            outOfRange: {
                mmsi: "5",
                lat: 1,
                lon: 2,
                last_updated: 1e100,
            },
        };

        const entities = mapMaritimeFleetPayload(payload);
        expect(entities).toHaveLength(1);
        const ts = entities![0].timestamp.getTime();
        expect(Number.isFinite(ts)).toBe(true);
        expect(ts).toBeGreaterThanOrEqual(before);
    });
});
