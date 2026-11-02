import { LatLngBounds, latLngBounds, point, type Map as LeafletMap } from "leaflet";

// On a phone the open bottom sheet covers the lower part of the map. To keep a tapped point above
// it, the content may have to move up past the image's bottom edge, which the map's pan limit
// (maxBounds, the image) forbids. These widen the limit below the image for that move, and narrow
// it back to the image when the sheet closes.

/** Leaflet's latitude per CSS pixel at the current zoom (CRS.Simple: the same everywhere). */
function latitudePerCssPixel(leafletMap: LeafletMap): number {
  return (
    leafletMap.containerPointToLatLng(point(0, 0)).lat -
    leafletMap.containerPointToLatLng(point(0, 1)).lat
  );
}

/** Moves the map's content up by distanceCssPixels, past the image's bottom edge if need be. */
export function moveContentUpPastImage(
  leafletMap: LeafletMap,
  distanceCssPixels: number,
  isAnimated: boolean,
): void {
  if (!(Number.isFinite(distanceCssPixels) && distanceCssPixels > 0)) {
    throw new Error(
      `The map content can only move up by a positive distance, got ${distanceCssPixels}`,
    );
  }
  const currentLimit = leafletMap.options.maxBounds;
  if (currentLimit === undefined) {
    throw new Error("The map has no pan limit yet (no minimap shown), so its content cannot move");
  }
  const limit = currentLimit instanceof LatLngBounds ? currentLimit : latLngBounds(currentLimit);
  // Twice the distance: while the image is smaller than the view, Leaflet centres the limit in the
  // view, so only half of any room added below the image moves the content.
  const southLatitude = limit.getSouth() - 2 * distanceCssPixels * latitudePerCssPixel(leafletMap);
  // Assigned, not setMaxBounds: that would pan into the new limit at once, on top of the pan below.
  // Leaflet reads this option at the end of every move and at the start of every drag.
  leafletMap.options.maxBounds = latLngBounds(
    [southLatitude, limit.getWest()],
    [limit.getNorth(), limit.getEast()],
  );
  leafletMap.panBy(point(0, distanceCssPixels), { animate: isAnimated });
}

/** Gives back any room moveContentUpPastImage added: the image is the pan limit again. */
export function releaseRoomBelowImage(
  leafletMap: LeafletMap,
  imageBounds: LatLngBounds,
  isAnimated: boolean,
): void {
  leafletMap.options.maxBounds = imageBounds;
  leafletMap.panInsideBounds(imageBounds, { animate: isAnimated });
}
