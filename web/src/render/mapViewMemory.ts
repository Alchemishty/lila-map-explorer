import type { Map as LeafletMap } from "leaflet";
import { pixelToWorld, worldToPixel } from "../domain/coordinates";
import type { MapConfig } from "../domain/types";
import { imageLatLngToPixel, pixelToImageLatLng } from "./imageLatLng";
import type { SavedMapView } from "./mapViewContract";

// Saving and restoring a view, so a mode can come back to where the designer left it. The centre
// is kept in world space, so it means the same spot whatever the container's size is later.

/** The map's centre and zoom now, on the minimap shown. */
export function saveLeafletView(leafletMap: LeafletMap, shownMap: MapConfig): SavedMapView {
  const centerLatLng = leafletMap.getCenter();
  return {
    mapId: shownMap.mapId,
    centerWorld: pixelToWorld(
      imageLatLngToPixel(centerLatLng.lat, centerLatLng.lng, shownMap),
      shownMap,
    ),
    zoomLevel: leafletMap.getZoom(),
  };
}

/** Puts the saved centre and zoom back at once. Leaflet still keeps the view inside its limits. */
export function restoreLeafletView(
  leafletMap: LeafletMap,
  shownMap: MapConfig,
  view: SavedMapView,
): void {
  if (view.mapId !== shownMap.mapId) {
    throw new Error(
      `A view saved on map "${view.mapId}" cannot be restored while map "${shownMap.mapId}" is shown`,
    );
  }
  // Leaflet only re-measures its container on a window resize; the layout may have changed since.
  leafletMap.invalidateSize({ pan: false });
  leafletMap.setView(
    pixelToImageLatLng(worldToPixel(view.centerWorld, shownMap), shownMap),
    view.zoomLevel,
    { animate: false },
  );
}
