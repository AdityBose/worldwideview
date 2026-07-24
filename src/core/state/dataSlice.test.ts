/* eslint-disable @typescript-eslint/no-explicit-any */
import {
 describe, it, expect, beforeEach, vi
} from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { GeoEntity } from '@/core/plugins/PluginTypes';
import { createDataSlice, DataSlice } from './dataSlice';

// We need a mock store that includes selectedEntity + layers to test cross-slice updates
interface MockAppStore extends DataSlice {
    selectedEntity: GeoEntity | null;
    layers: Record<string, { enabled: boolean; entityCount: number; loading: boolean }>;
}

describe('dataSlice', () => {
    let store: StoreApi<MockAppStore>;

    beforeEach(() => {
        store = createStore<MockAppStore>((set, get, api) => {
            const dataSlice = createDataSlice(set as any, get as any, api as any);
            return {
                ...dataSlice,
                selectedEntity: null,
                layers: {},
            };
        });
    });

    it('initializes with empty entities', () => {
        expect(store.getState().entitiesByPlugin).toEqual({});
    });

    it('sets entities for a plugin', () => {
        const mockEntities = [{ id: 'e1', pluginId: 'plugin-a' } as GeoEntity];
        store.getState().setEntities('plugin-a', mockEntities);

        expect(store.getState().entitiesByPlugin['plugin-a']).toEqual(mockEntities);
    });

    it('updates selectedEntity if new data for the same entity arrives', () => {
        // Initial selected entity
        const oldEntity = { id: 'e1', pluginId: 'plugin-a', name: 'Old Name' } as any as GeoEntity;
        store.setState({ selectedEntity: oldEntity });

        // New data arrives with updated name
        const freshEntity = { id: 'e1', pluginId: 'plugin-a', name: 'New Name' } as any as GeoEntity;
        store.getState().setEntities('plugin-a', [freshEntity]);

        expect(store.getState().selectedEntity).toEqual(freshEntity);
    });

    it('does not update selectedEntity if new data does not contain it', () => {
        const oldEntity = { id: 'e1', pluginId: 'plugin-a', name: 'Old Name' } as any as GeoEntity;
        store.setState({ selectedEntity: oldEntity });

        // New data arrives but the entity is missing
        store.getState().setEntities('plugin-a', [{ id: 'e2', pluginId: 'plugin-a' } as GeoEntity]);

        expect(store.getState().selectedEntity).toEqual(oldEntity);
    });

    it('clears entities for a specific plugin', () => {
        const mockEntitiesA = [{ id: 'e1', pluginId: 'plugin-a' } as GeoEntity];
        const mockEntitiesB = [{ id: 'e2', pluginId: 'plugin-b' } as GeoEntity];

        store.getState().setEntities('plugin-a', mockEntitiesA);
        store.getState().setEntities('plugin-b', mockEntitiesB);

        store.getState().clearEntities('plugin-a');

        expect(store.getState().entitiesByPlugin['plugin-a']).toBeUndefined();
        expect(store.getState().entitiesByPlugin['plugin-b']).toEqual(mockEntitiesB);
    });

    it('resets layer entityCount when clearing entities', () => {
        store.setState({
            layers: {
                'plugin-a': { enabled: true, entityCount: 42, loading: false },
                'plugin-b': { enabled: true, entityCount: 7, loading: false },
            },
        });
        store.getState().setEntities('plugin-a', [{ id: 'e1', pluginId: 'plugin-a' } as GeoEntity]);

        store.getState().clearEntities('plugin-a');

        expect(store.getState().entitiesByPlugin['plugin-a']).toBeUndefined();
        expect(store.getState().layers['plugin-a'].entityCount).toBe(0);
        expect(store.getState().layers['plugin-b'].entityCount).toBe(7);
    });

    it('gets all entities across plugins flattened', () => {
        const mockEntitiesA = [{ id: 'e1', pluginId: 'plugin-a' } as GeoEntity];
        const mockEntitiesB = [{ id: 'e2', pluginId: 'plugin-b' } as GeoEntity];

        store.getState().setEntities('plugin-a', mockEntitiesA);
        store.getState().setEntities('plugin-b', mockEntitiesB);

        const all = store.getState().getAllEntities();

        expect(all).toHaveLength(2);
        expect(all).toContainEqual(mockEntitiesA[0]);
        expect(all).toContainEqual(mockEntitiesB[0]);
    });
});
