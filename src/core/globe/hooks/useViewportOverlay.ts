import { useEffect, useRef } from "react";
import type { Viewer as CesiumViewer } from "cesium";
import { Color, Rectangle, Entity as CesiumEntity } from "cesium";
import { useStore } from "@/core/state/store";
import { MARITIME_PLUGIN_ID } from "@/core/plugins/pluginIds";

/**
 * Hook that renders a translucent bounding box overlay representing the active
 * tracking zone on the 3D globe whenever the maritime plugin is enabled and an active
 * camera-scoped viewport coordinate is loaded.
 */
export function useViewportOverlay(viewer: CesiumViewer | null, isReady: boolean) {
    const rectangleEntityRef = useRef<CesiumEntity | null>(null);

    const currentViewport = useStore((s) => s.currentViewport);
    const isMaritimeEnabled = useStore((s) => s.layers[MARITIME_PLUGIN_ID]?.enabled ?? false);

    useEffect(() => {
        if (!viewer || viewer.isDestroyed() || !isReady) return;

        // Clean up previous rectangle
        if (rectangleEntityRef.current) {
            viewer.entities.remove(rectangleEntityRef.current);
            rectangleEntityRef.current = null;
        }

        // Draw new rectangle if viewport is active and maritime is enabled
        if (currentViewport && isMaritimeEnabled) {
            const [minLat, minLon, maxLat, maxLon] = currentViewport;

            try {
                // Cesium's Rectangle.fromDegrees handles antimeridian crossing (minLon > maxLon)
                // out of the box by automatically wrapping around the 180° meridian.
                rectangleEntityRef.current = viewer.entities.add({
                    id: "maritime-viewport-overlay",
                    rectangle: {
                        coordinates: Rectangle.fromDegrees(minLon, minLat, maxLon, maxLat),
                        material: Color.fromCssColorString("#10b981").withAlpha(0.08), // translucent emerald green fill
                        outline: true,
                        outlineColor: Color.fromCssColorString("#10b981").withAlpha(0.4), // soft green border
                        // Cesium does not support rectangle outline widths > 1 on WebGL/ANGLE
                        // (values above 1 are silently clamped); keep at the max reliably honored.
                        outlineWidth: 1,
                    },
                });
            } catch (err) {
                console.error("[useViewportOverlay] Error drawing viewport bounding box:", err);
            }
        }

        return () => {
            if (rectangleEntityRef.current && viewer && !viewer.isDestroyed()) {
                viewer.entities.remove(rectangleEntityRef.current);
                rectangleEntityRef.current = null;
            }
        };
    }, [viewer, isReady, currentViewport, isMaritimeEnabled]);
}
