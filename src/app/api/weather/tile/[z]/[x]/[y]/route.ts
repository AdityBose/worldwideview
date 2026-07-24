import { NextRequest, NextResponse } from "next/server";
import { WEATHER_LAYERS, isValidWeatherLayer } from "@/lib/weatherLayers";

export const revalidate = 600;

const MAX_ZOOM = 18;

// Rate limiting & Caching configuration
const MAX_CALLS_WINDOW = 1000;
const WINDOW_DURATION_MS = 32 * 60 * 60 * 1000; // 32 hours
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour in-memory tile cache
const MAX_TILE_CACHE_ENTRIES = 500;

interface CachedTile {
    buffer: ArrayBuffer;
    timestamp: number;
}

const tileCache = new Map<string, CachedTile>();
const inflightFetches = new Map<string, Promise<ArrayBuffer>>();
let callTimestamps: number[] = [];

/** Exported for testing purposes to reset rate limiter & tile cache */
export function _resetRateLimiterAndCache(): void {
    tileCache.clear();
    inflightFetches.clear();
    callTimestamps = [];
}

function pruneExpiredTiles(now: number): void {
    for (const [key, entry] of tileCache) {
        if (now - entry.timestamp >= CACHE_TTL_MS) {
            tileCache.delete(key);
        }
    }
}

function setCachedTile(cacheKey: string, buffer: ArrayBuffer, now: number): void {
    pruneExpiredTiles(now);

    // Refresh insertion order for LRU semantics (Map preserves order).
    if (tileCache.has(cacheKey)) {
        tileCache.delete(cacheKey);
    }
    tileCache.set(cacheKey, { buffer, timestamp: now });

    while (tileCache.size > MAX_TILE_CACHE_ENTRIES) {
        const oldestKey = tileCache.keys().next().value;
        if (oldestKey === undefined) break;
        tileCache.delete(oldestKey);
    }
}

function checkAndRecordRateLimit(): boolean {
    const now = Date.now();
    const cutoff = now - WINDOW_DURATION_MS;
    callTimestamps = callTimestamps.filter((ts) => ts > cutoff);

    if (callTimestamps.length >= MAX_CALLS_WINDOW) {
        return false;
    }

    callTimestamps.push(now);
    return true;
}

function isValidTileCoord(value: string, zoom?: number): boolean {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) return false;
    if (zoom !== undefined) {
        if (n >= Math.pow(2, zoom)) return false;
    }
    return true;
}

function isValidZoom(value: string): boolean {
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && n <= MAX_ZOOM;
}

function pngResponse(buffer: ArrayBuffer, cacheHit: boolean): Response {
    return new Response(buffer, {
        status: 200,
        headers: {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=600, stale-while-revalidate=300",
            "X-Cache-Hit": cacheHit ? "true" : "false",
        },
    });
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ z: string; x: string; y: string }> },
) {
    const { z, x, y } = await params;
    const layer = req.nextUrl.searchParams.get("layer");

    if (!layer || !isValidWeatherLayer(layer)) {
        return NextResponse.json(
            { error: `Invalid layer. Must be one of: ${WEATHER_LAYERS.join(", ")}` },
            { status: 400 },
        );
    }

    if (!isValidZoom(z)) {
        return NextResponse.json(
            { error: "Invalid tile coordinates" },
            { status: 400 },
        );
    }

    const zNum = Number(z);
    if (!isValidTileCoord(x, zNum) || !isValidTileCoord(y, zNum)) {
        return NextResponse.json(
            { error: "Invalid tile coordinates" },
            { status: 400 },
        );
    }

    const apiKey = process.env.OPENWEATHERMAP_API_KEY;
    if (!apiKey) {
        return NextResponse.json(
            { error: "Weather API not configured" },
            { status: 503 },
        );
    }

    const cacheKey = `${layer}/${z}/${x}/${y}`;
    const now = Date.now();

    // 1. Check in-memory tile cache first (also prune expired entries opportunistically)
    pruneExpiredTiles(now);
    const cached = tileCache.get(cacheKey);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
        // Touch for LRU
        tileCache.delete(cacheKey);
        tileCache.set(cacheKey, cached);
        return pngResponse(cached.buffer, true);
    }

    // 2. Coalesce concurrent misses for the same tile
    const existingInflight = inflightFetches.get(cacheKey);
    if (existingInflight) {
        try {
            const buffer = await existingInflight;
            return pngResponse(buffer, false);
        } catch {
            return NextResponse.json(
                { error: "Failed to fetch weather tile" },
                { status: 502 },
            );
        }
    }

    // 3. Check rate limit before calling upstream API (max 1000 calls / 32 hours)
    if (!checkAndRecordRateLimit()) {
        return NextResponse.json(
            { error: "Weather API rate limit reached (max 1000 calls per 32 hours)" },
            { status: 429 },
        );
    }

    const tileUrl = `https://tile.openweathermap.org/map/${layer}/${z}/${x}/${y}.png?appid=${apiKey}`;

    const fetchPromise = (async (): Promise<ArrayBuffer> => {
        const response = await fetch(tileUrl, {
            headers: { "User-Agent": "WorldWideView/1.0" },
            next: { revalidate },
        });

        if (!response.ok) {
            throw new Error(`Upstream tile fetch failed: ${response.status}`);
        }

        return response.arrayBuffer();
    })();

    inflightFetches.set(cacheKey, fetchPromise);

    try {
        const buffer = await fetchPromise;
        setCachedTile(cacheKey, buffer, Date.now());
        return pngResponse(buffer, false);
    } catch {
        return NextResponse.json(
            { error: "Failed to fetch weather tile" },
            { status: 502 },
        );
    } finally {
        inflightFetches.delete(cacheKey);
    }
}
