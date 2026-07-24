import type { WsStreamPayload, GeoEntity } from "@worldwideview/wwv-plugin-sdk";
import { dataBus } from "./DataBus";
import { cacheLayer } from "./CacheLayer";
import { mapMaritimeFleetPayload } from "./mapMaritimePayload";
import { pluginManager } from "../plugins/PluginManager";
import { useStore } from "../state/store";
import { ticketAuthEnabledForPlugin } from "../edition";
import { MARITIME_PLUGIN_ID } from "../plugins/pluginIds";
import type { PluginTicket } from "@worldwideview/wwv-plugin-sdk";

async function fetchPluginTicket(pluginId: string): Promise<PluginTicket | null> {
  const res = await fetch(`/api/auth/ticket?pluginId=${encodeURIComponent(pluginId)}`);
  if (!res.ok) throw new Error(`[WSClient] Ticket fetch failed (${res.status}) for ${pluginId}`);
  const data = await res.json() as { token?: string; noCredential?: boolean };
  if (data.noCredential) {
    console.debug(`[WSClient] No credential for ${pluginId} — skipping auth`);
    return null;
  }
  if (!data.token) throw new Error(`[WSClient] Ticket response missing token for ${pluginId}`);
  return data.token as PluginTicket;
}

interface EngineConnection {
  ws: WebSocket | null;
  reconnectTimer: NodeJS.Timeout | null;
  subscriptions: Set<string>;
  /** Grace period timer — closes the connection if no plugins remain subscribed */
  cleanupTimer: NodeJS.Timeout | null;
  /** Backoff attempt counter — resets after a stable connection (>5s open) */
  reconnectAttempts: number;
  /** Timer that resets the backoff counter once a connection has been stable */
  stableConnectionTimer: NodeJS.Timeout | null;
  /** True while waiting for the server's welcome after sending an auth message */
  awaitingWelcome: boolean;
  /** Closes the connection if the server doesn't send welcome within 3s */
  authTimeoutTimer: NodeJS.Timeout | null;
}

const RECONNECT_BASE_MS = 5000;
const RECONNECT_MAX_MS = 60000; // Cap at 1 minute
const RECONNECT_JITTER_MS = 4000;
const STABLE_CONNECTION_MS = 5000; // Reset backoff after 5s of stable connection
const CLEANUP_GRACE_MS = 30000;

/** Normalizes underscore-based pluginIds to kebab-case (e.g. `my_plugin` → `my-plugin`). */
function normalizePluginId(id: string): string {
  return id.replace(/_/g, "-");
}

class WebSocketClient {
  private engines = new Map<string, EngineConnection>();

  constructor() {
    this.initializeViewportListener();
  }

  private initializeViewportListener() {
    if (typeof window === "undefined") return;
    if (typeof useStore.subscribe !== "function") {
      console.debug("[WSClient] useStore.subscribe is not a function (mocked in tests) — bypassing viewport listener");
      return;
    }

    let prevViewport: [number, number, number, number] | null = null;

    useStore.subscribe((state) => {
      const viewport = state?.currentViewport || null;
      // Issue C Optimization: Reference equality fast-path check.
      // Since state.currentViewport is only updated on debounced settles, its reference
      // remains identical during 99.9% of store mutations (FPS updates, clock ticks, etc.).
      if (viewport === prevViewport) return;

      // Deep string diff only when store reference changes
      if (JSON.stringify(viewport) === JSON.stringify(prevViewport)) {
        prevViewport = viewport;
        return;
      }
      prevViewport = viewport;
      this.updateViewportSubscriptions(viewport);
    });
  }

  private updateViewportSubscriptions(viewport: [number, number, number, number] | null) {
    // Only act on engines that have an OPEN maritime socket ready to receive a
    // fresh subscription this cycle. If none is ready (e.g. mid-reconnect), skip
    // entirely — clearing local entities without being able to push a new
    // subscription would blank the globe with no recovery until the socket
    // reopens. The onopen/welcome handlers replay the current viewport on
    // reconnect, so nothing is lost by skipping here.
    const readyEngines = [...this.engines.values()].filter(
      (engine) => engine.subscriptions.has(MARITIME_PLUGIN_ID) && engine.ws?.readyState === WebSocket.OPEN
    );
    if (readyEngines.length === 0) return;

    // Keep the previous fleet while an in-range viewport request is in flight.
    // The next maritime snapshot replaces it atomically through the normal DataBus
    // path, avoiding an empty globe during the seeder's flush interval. Zoom-out is
    // different: clear immediately because maritime paint is intentionally disabled.
    if (viewport === null) {
      useStore.getState().clearEntities(MARITIME_PLUGIN_ID);
      cacheLayer.invalidate(MARITIME_PLUGIN_ID);
    }

    for (const engine of readyEngines) {
      this.updateSubscriptionForEngine(engine, viewport);
    }
  }

  private updateSubscriptionForEngine(engine: EngineConnection, viewport: [number, number, number, number] | null) {
    if (!engine.ws || engine.ws.readyState !== WebSocket.OPEN) return;

    // Zoomed out: still register interest with the engine (required for broadcast),
    // but do NOT attach a fake chokepoint box (previously Malacca). Painting is
    // gated in handleDataMessage while currentViewport is null so HUD stays honest.
    // Do not send boundingBoxes: [] — engine may treat empty as "global".
    if (!viewport) {
      this.send(engine, { action: "subscribe", pluginId: MARITIME_PLUGIN_ID });
      console.debug("[WSClient] Maritime subscribe without bbox (zoomed out — UI will not paint)");
      return;
    }

    const [minLat, minLon, maxLat, maxLon] = viewport;
    let boxes: number[][][];

    // Issue D: Antimeridian detection.
    // Implicit invariant: minLon > maxLon is only possible when crossing the antimeridian,
    // guaranteed by the 45° viewport gate inside src/core/globe/hooks/useCameraSync.ts.
    if (minLon > maxLon) {
      // View crosses the Antimeridian (180° longitude).
      // Split into two boxes so a single box does not wrap the long way (~340°).
      boxes = [
        [[minLat, minLon], [maxLat, 180.0]],
        [[minLat, -180.0], [maxLat, maxLon]]
      ];
    } else {
      boxes = [
        [[minLat, minLon], [maxLat, maxLon]]
      ];
    }

    const payload = {
      action: "subscribe",
      pluginId: MARITIME_PLUGIN_ID,
      boundingBoxes: boxes
    };

    this.send(engine, payload);
    console.debug(`[WSClient] Dynamic maritime bounding boxes pushed:`, JSON.stringify(boxes));
  }

  private getOrCreateEngine(engineUrl: string): EngineConnection {
    let engine = this.engines.get(engineUrl);
    if (!engine) {
      engine = {
        ws: null,
        reconnectTimer: null,
        subscriptions: new Set(),
        cleanupTimer: null,
        reconnectAttempts: 0,
        stableConnectionTimer: null,
        awaitingWelcome: false,
        authTimeoutTimer: null,
      };
      this.engines.set(engineUrl, engine);
    }
    return engine;
  }

  private connectEngine(engineUrl: string) {
    const engine = this.getOrCreateEngine(engineUrl);

    if (engine.ws && (engine.ws.readyState === WebSocket.CONNECTING || engine.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    const wsStart = performance.now();
    engine.ws = new WebSocket(engineUrl);

    engine.ws.onopen = () => {
      console.debug(`[WSClient] 🟢 Connected to ${engineUrl}. WS Handshake took ${(performance.now() - wsStart).toFixed(2)}ms`);
      // Only reset backoff if the connection stays open for a non-trivial time —
      // an immediate close (e.g. server-side rejection) shouldn't be treated as success.
      if (engine.stableConnectionTimer) clearTimeout(engine.stableConnectionTimer);
      engine.stableConnectionTimer = setTimeout(() => {
        engine.reconnectAttempts = 0;
      }, STABLE_CONNECTION_MS);

      // Check whether any subscription on this engine requires ticket auth.
      const ticketPlugin = [...engine.subscriptions].find((id) => ticketAuthEnabledForPlugin(id));
      if (ticketPlugin) {
        engine.awaitingWelcome = true;
        fetchPluginTicket(ticketPlugin)
          .then((ticket) => {
            if (!ticket) {
              // No credential available (user hasn't connected to Marketplace yet).
              // Skip auth and subscribe immediately, same as the non-auth path.
              engine.awaitingWelcome = false;
              for (const pluginId of engine.subscriptions) {
                if (pluginId === MARITIME_PLUGIN_ID) {
                  this.updateSubscriptionForEngine(engine, useStore.getState().currentViewport);
                } else {
                  this.send(engine, { action: "subscribe", pluginId });
                }
              }
              return;
            }
            this.send(engine, { type: "auth", v: 1, token: ticket });
            // 3s timeout — if the server doesn't send welcome, close and trigger reconnect.
            engine.authTimeoutTimer = setTimeout(() => {
              if (engine.awaitingWelcome) {
                console.warn(`[WSClient] Auth timeout waiting for welcome from ${engineUrl}. Closing to reconnect.`);
                engine.ws?.close();
              }
            }, 3000);
          })
          .catch((err: unknown) => {
            console.error(`[WSClient] Failed to get ticket for ${ticketPlugin}:`, err instanceof Error ? err.message : err);
            engine.ws?.close();
          });
      } else {
        // No ticket auth required — subscribe immediately.
        for (const pluginId of engine.subscriptions) {
          if (pluginId === MARITIME_PLUGIN_ID) {
            this.updateSubscriptionForEngine(engine, useStore.getState().currentViewport);
          } else {
            this.send(engine, { action: "subscribe", pluginId });
          }
        }
      }
    };

    engine.ws.onmessage = (event) => {
      try {
        const msgTime = performance.now();
        console.debug(`[WSClient] 📥 Received raw message at +${(msgTime - wsStart).toFixed(2)}ms from start:`, event.data.substring(0, 150) + (event.data.length > 150 ? '...' : ''));
        const data = JSON.parse(event.data);

        if (data.type === "welcome") {
          console.debug(`[WSClient] 👋 Engine ${engineUrl} serves: ${data.plugins?.join(", ")}`);
          if (engine.awaitingWelcome) {
            engine.awaitingWelcome = false;
            if (engine.authTimeoutTimer) { clearTimeout(engine.authTimeoutTimer); engine.authTimeoutTimer = null; }
            for (const pluginId of engine.subscriptions) {
              if (pluginId === MARITIME_PLUGIN_ID) {
                this.updateSubscriptionForEngine(engine, useStore.getState().currentViewport);
              } else {
                this.send(engine, { action: "subscribe", pluginId });
              }
            }
          }
          return;
        }

        if (data.type === "data" && data.pluginId && data.payload) {
          this.handleDataMessage(data as WsStreamPayload);
        }
      } catch (err) {
        console.error("[WSClient] Error parsing message:", err);
      }
    };

    engine.ws.onerror = () => {
      console.warn(`[WSClient] Connection to ${engineUrl} failed. Retrying in background...`);
    };

    engine.ws.onclose = () => {
      engine.ws = null;
      engine.awaitingWelcome = false;
      if (engine.authTimeoutTimer) { clearTimeout(engine.authTimeoutTimer); engine.authTimeoutTimer = null; }
      if (engine.stableConnectionTimer) {
        clearTimeout(engine.stableConnectionTimer);
        engine.stableConnectionTimer = null;
      }
      if (engine.reconnectTimer) clearTimeout(engine.reconnectTimer);
      // Only reconnect if there are still active subscriptions
      if (engine.subscriptions.size > 0) {
        // Exponential backoff with jitter to prevent thundering herd on engine restart.
        // 5s -> 10s -> 20s -> 40s -> 60s (cap), plus ±4s of jitter so simultaneous
        // sessions don't all reconnect at the same instant.
        const expDelay = Math.min(
          RECONNECT_BASE_MS * Math.pow(2, engine.reconnectAttempts),
          RECONNECT_MAX_MS
        );
        const delay = expDelay + Math.random() * RECONNECT_JITTER_MS;
        engine.reconnectAttempts++;
        console.warn(`[WSClient] Disconnected from ${engineUrl}. Reconnecting in ${Math.round(delay / 1000)}s (attempt ${engine.reconnectAttempts})...`);
        engine.reconnectTimer = setTimeout(() => this.connectEngine(engineUrl), delay);
      }
    };
  }

  private handleDataMessage(data: WsStreamPayload) {
    const pluginId = normalizePluginId(data.pluginId!);
    const plugin = pluginManager.getPlugin(pluginId)?.plugin;
    let finalEntities: GeoEntity[];
    const existingEntities = useStore.getState().entitiesByPlugin[pluginId] || [];

    // Plugin mapper always wins when present (richer fields / trails / filters).
    if (plugin && typeof (plugin as any).mapWebsocketPayload === "function") {
      finalEntities = (plugin as any).mapWebsocketPayload(data.payload, existingEntities);
    } else if (pluginId === MARITIME_PLUGIN_ID) {
      // Core fallback: seeder publishes MMSI→ship dict; SDK type says GeoEntity[].
      const mapped = mapMaritimeFleetPayload(data.payload);
      if (mapped) {
        finalEntities = mapped;
      } else if (Array.isArray(data.payload)) {
        finalEntities = data.payload.map((e) => ({
          ...e,
          timestamp: new Date(e.timestamp || Date.now()),
        }));
      } else {
        console.warn(`[WsClient] Payload for ${pluginId} is not a fleet object or array. Ignoring.`);
        return;
      }
    } else if (!Array.isArray(data.payload)) {
      console.warn(`[WsClient] Payload for ${pluginId} is an object but no mapWebsocketPayload exists. Ignoring.`);
      return;
    } else {
      finalEntities = data.payload.map((e) => ({
        ...e,
        timestamp: new Date(e.timestamp || Date.now()),
      }));
    }

    // Zoomed out: stay subscribed for engine interest, but do not paint ships.
    // Matches AppShell HUD ("Zoom in to view live shipping activity").
    if (pluginId === MARITIME_PLUGIN_ID && useStore.getState().currentViewport == null) {
      console.debug("[WSClient] Dropping maritime paint while zoomed out (viewport null)");
      return;
    }

    console.debug(`[WSClient] Dispatching ${finalEntities.length} entities for ${pluginId} to DataBus`);

    dataBus.emit("dataUpdated", {
      pluginId,
      entities: finalEntities,
    });
  }

  private send(engine: EngineConnection, msg: any) {
    if (engine.ws && engine.ws.readyState === WebSocket.OPEN) {
      engine.ws.send(JSON.stringify(msg));
    }
  }

  public subscribe(pluginId: string, engineUrl: string) {
    console.debug(`[WSClient] 📡 Subscribing to ${pluginId} at ${engineUrl}`);
    const engine = this.getOrCreateEngine(engineUrl);

    // Cancel any pending cleanup
    if (engine.cleanupTimer) {
      clearTimeout(engine.cleanupTimer);
      engine.cleanupTimer = null;
    }

    engine.subscriptions.add(pluginId);
    this.connectEngine(engineUrl);
    // Only send immediately if auth is not in-flight; the welcome handler will
    // replay all pending subscriptions once auth succeeds (see onmessage:121-124).
    if (!engine.awaitingWelcome) {
      if (pluginId === MARITIME_PLUGIN_ID) {
        this.updateSubscriptionForEngine(engine, useStore.getState().currentViewport);
      } else {
        this.send(engine, { action: "subscribe", pluginId });
      }
    }
  }

  public unsubscribe(pluginId: string, engineUrl: string) {
    const engine = this.engines.get(engineUrl);
    if (!engine) return;

    engine.subscriptions.delete(pluginId);
    this.send(engine, { action: "unsubscribe", pluginId });

    // If no more subscriptions for this engine, schedule cleanup
    if (engine.subscriptions.size === 0) {
      engine.cleanupTimer = setTimeout(() => {
        if (engine.subscriptions.size === 0) {
          console.log(`[WSClient] No subscriptions remain for ${engineUrl}. Closing connection.`);
          if (engine.reconnectTimer) clearTimeout(engine.reconnectTimer);
          if (engine.stableConnectionTimer) clearTimeout(engine.stableConnectionTimer);
          if (engine.authTimeoutTimer) { clearTimeout(engine.authTimeoutTimer); engine.authTimeoutTimer = null; }
          engine.ws?.close();
          this.engines.delete(engineUrl);
        }
      }, CLEANUP_GRACE_MS);
    }
  }

  public printConnections() {
    const table: any[] = [];
    this.engines.forEach((engine, url) => {
      table.push({
        'Engine URL': url,
        Status: engine.ws ? ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][engine.ws.readyState] || 'UNKNOWN' : 'DISCONNECTED',
        'Plugins Subscribed': Array.from(engine.subscriptions).join(", ") || "(None)",
      });
    });
    console.groupCollapsed("[WSClient] Active Engine Connections Matrix");
    console.table(table);
    console.groupEnd();
  }
}

export const wsClient = new WebSocketClient();

if (typeof window !== "undefined") {
  (window as any).wwvDebugConnections = () => wsClient.printConnections();
}
