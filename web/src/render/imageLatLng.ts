import type { MapConfig, PixelPoint } from "../domain/types";

// The image-pixel <-> Leaflet LatLng step inside MapView's world <-> canvas crossing.
// Leaflet CRS.Simple puts latitude up and longitude right, one unit per image pixel at zoom 0, so the
// image spans [[0, 0], [imageHeightPixels, imageWidthPixels]] and the image's downward y flips.
// Only mapView.ts uses these; nothing else touches LatLng values.

/** A Leaflet [latitude, longitude] pair in CRS.Simple image space. */
export type ImageLatLngTuple = [latitude: number, longitude: number];

export function imageBoundsFor(map: MapConfig): [ImageLatLngTuple, ImageLatLngTuple] {
  return [
    [0, 0],
    [map.imageHeightPixels, map.imageWidthPixels],
  ];
}

export function pixelToImageLatLng(point: PixelPoint, map: MapConfig): ImageLatLngTuple {
  return [map.imageHeightPixels - point.pixelY, point.pixelX];
}

export function imageLatLngToPixel(
  latitude: number,
  longitude: number,
  map: MapConfig,
): PixelPoint {
  return { pixelX: longitude, pixelY: map.imageHeightPixels - latitude };
}
