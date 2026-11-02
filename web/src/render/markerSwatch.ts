import type { MarkerStyle } from "../domain/types";
import { drawMarker, fullMarkerAppearance, markerRadiusPixels } from "./drawMarkers";

// A small canvas showing one marker exactly as the map draws it, for the legend. It is its own
// canvas, separate from the map overlay that only render/scene.ts draws on.

/** The swatch's side in CSS pixels: the marker plus room for its outline. */
export const markerSwatchSizePixels = 2 * markerRadiusPixels + 6;

export function createMarkerSwatch(style: MarkerStyle): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const devicePixelRatio = window.devicePixelRatio;
  canvas.width = Math.round(markerSwatchSizePixels * devicePixelRatio);
  canvas.height = Math.round(markerSwatchSizePixels * devicePixelRatio);
  canvas.style.width = `${markerSwatchSizePixels}px`;
  canvas.style.height = `${markerSwatchSizePixels}px`;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("This browser cannot draw on a 2D canvas, so the legend cannot be shown");
  }
  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  const centerPixels = markerSwatchSizePixels / 2;
  drawMarker(
    context,
    { canvasX: centerPixels, canvasY: centerPixels },
    style,
    fullMarkerAppearance,
  );
  return canvas;
}
