/**
 * @file dataSlice.ts
 * @description State slice managing the core geospatial entities retrieved from all active plugins.
 */

import type { StateCreator } from "zustand";
import type { GeoEntity } from "@/core/plugins/PluginTypes";
import type { AppStore } from "./store";

// ─── Data Slice ──────────────────────────────────────────────
/**
 * Zustand state slice for storing and retrieving geospatial entity data.
 */
export interface DataSlice {
    /** Map of plugin IDs to their currently loaded arrays of GeoEntities. */
    entitiesByPlugin: Record<string, GeoEntity[]>;
    /** Updates the entity list for a specific plugin and refreshes selection if needed. */
    setEntities: (pluginId: string, entities: GeoEntity[]) => void;
    /** Removes all entities for a plugin and resets that layer's entityCount to 0. */
    clearEntities: (pluginId: string) => void;
    /** Retrieves a flattened array of all visible entities from all active plugins. */
    getAllEntities: () => GeoEntity[];
}

export const createDataSlice: StateCreator<AppStore, [], [], DataSlice> = (set, get) => ({
    entitiesByPlugin: {},
    setEntities: (pluginId, entities) => set((state) => {
            const updates: Partial<AppStore> = {
                entitiesByPlugin: { ...state.entitiesByPlugin, [pluginId]: entities },
            };
            // Keep selectedEntity fresh when new polling data arrives
            if (state.selectedEntity?.pluginId === pluginId) {
                const fresh = entities.find((e) => e.id === state.selectedEntity!.id);
                if (fresh) updates.selectedEntity = fresh;
            }
            return updates;
        }),
    clearEntities: (pluginId) => set((state) => {
            const entitiesByPlugin = { ...state.entitiesByPlugin };
            delete entitiesByPlugin[pluginId];

            // Keep layer panel count aligned with the globe. Viewport clears and
            // other callers historically only wiped entities, leaving a stale count.
            const layers = { ...state.layers };
            if (layers[pluginId]) {
                layers[pluginId] = { ...layers[pluginId], entityCount: 0 };
            }

            return { entitiesByPlugin, layers };
        }),
    getAllEntities: () => {
        const state = get();
        return Object.values(state.entitiesByPlugin).flat();
    },
});
