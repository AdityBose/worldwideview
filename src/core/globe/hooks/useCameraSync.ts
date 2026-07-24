/* eslint-disable react-hooks/immutability */
import { useEffect, useRef } from "react";
import type { Viewer as CesiumViewer } from "cesium";
import { Cartographic, Math as CesiumMath } from "cesium";
import { trackEvent } from "@/lib/analytics";
import { useStore } from "@/core/state/store";

const CAMERA_DEBOUNCE_MS = 2000;
/** Only fire camera.changed when the view has moved by at least 0.5% */
const CAMERA_PERCENTAGE_CHANGED = 0.005;

export function useCameraSync(
    viewer: CesiumViewer | null,
    isReady: boolean,
    setCameraPosition: (lat: number, lon: number, alt: number, heading: number, pitch: number, roll: number) => void,
    setFps: (fps: number) => void
) {
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Camera position sync — uses camera.changed (fires only on meaningful movement)
    useEffect(() => {
        if (!viewer || viewer.isDestroyed() || !viewer.scene || !viewer.camera || !isReady) return;

        // Set the threshold for camera.changed to fire
        viewer.camera.percentageChanged = CAMERA_PERCENTAGE_CHANGED;

        const updateStore = () => {
            const {camera} = viewer;
            if (!camera || !camera.position) return;

            const cartographic = Cartographic.fromCartesian(camera.position);
            if (!cartographic) return;

            const lat = CesiumMath.toDegrees(cartographic.latitude ?? 0);
            const lon = CesiumMath.toDegrees(cartographic.longitude ?? 0);
            const alt = cartographic.height ?? 0;
            const heading = CesiumMath.toDegrees(camera.heading ?? 0);
            const pitch = CesiumMath.toDegrees(camera.pitch ?? 0);
            const roll = CesiumMath.toDegrees(camera.roll ?? 0);

            setCameraPosition(lat, lon, alt, heading, pitch, roll);

            // Debounced operations: fire after camera stops moving
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
                trackEvent("camera-move-end", {
                    lat: Math.round(lat * 100) / 100,
                    lon: Math.round(lon * 100) / 100,
                    alt: Math.round(alt),
                });

                // Compute exact view rectangle and sync viewport state
                const rect = camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
                if (!rect) {
                    // An oblique camera can temporarily have no globe rectangle even
                    // while the user remains close to the last tracked area. Preserve
                    // that viewport until Cesium provides a replacement rectangle or
                    // a confirmed wide view clears it below.
                    return;
                }

                const minLon = CesiumMath.toDegrees(rect.west);
                const minLat = CesiumMath.toDegrees(rect.south);
                const maxLon = CesiumMath.toDegrees(rect.east);
                const maxLat = CesiumMath.toDegrees(rect.north);

                // Bug 2 & Concern 4: Handle antimeridian (180° meridian) crossing correctly
                let longitudeSpan = maxLon - minLon;
                if (longitudeSpan < 0) {
                    longitudeSpan += 360;
                }

                // Bug 3: Guard both latitude and longitude spans to prevent vertical/wide view leaks
                const latitudeSpan = Math.abs(maxLat - minLat);

                // Guard: Avoid triggering subscriptions on zoomed-out global views to protect free API limits
                if (longitudeSpan > 45 || latitudeSpan > 45) {
                    useStore.getState().setViewport(null);
                } else {
                    useStore.getState().setViewport([minLat, minLon, maxLat, maxLon]);
                }
            }, CAMERA_DEBOUNCE_MS);
        };

        viewer.camera.changed.addEventListener(updateStore);

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            if (!viewer.isDestroyed()) {
                viewer.camera.changed.removeEventListener(updateStore);
            }
        };
    }, [viewer, isReady, setCameraPosition]);

    // FPS counter — needs to run per rendered frame
    useEffect(() => {
        if (!viewer || viewer.isDestroyed() || !viewer.scene || !isReady) return;

        let frameCount = 0;
        let lastTime = performance.now();

        const updateFps = () => {
            frameCount++;
            const currentTime = performance.now();
            if (currentTime - lastTime >= 1000) {
                const fps = Math.round((frameCount * 1000) / (currentTime - lastTime));
                setFps(fps);
                frameCount = 0;
                lastTime = currentTime;
            }
        };

        viewer.scene.postRender.addEventListener(updateFps);

        return () => {
            if (!viewer.isDestroyed()) {
                viewer.scene.postRender.removeEventListener(updateFps);
            }
        };
    }, [viewer, isReady, setFps]);
}
