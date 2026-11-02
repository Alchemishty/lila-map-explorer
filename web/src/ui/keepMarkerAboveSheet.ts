import type { CanvasPoint } from "../domain/types";
import type { MapView } from "../render/mapView";

// After a marker tap opens the phone's bottom sheet, the tapped marker must stay in sight above it.
// The sheet only covers the map on a phone; beside the map (desktop) it covers nothing, so nothing
// moves there.

/** The space (CSS px) kept between a tapped marker and the top edge of the sheet over it. */
export const markerClearanceAboveSheetPixels = 24;

/**
 * How far (CSS px) the map content must move up so a marker at markerCanvasY sits the clearance
 * above a cover whose top edge is at coverTopCanvasY; 0 when it already does.
 */
export function distanceToLiftAboveCover(markerCanvasY: number, coverTopCanvasY: number): number {
  if (!(Number.isFinite(markerCanvasY) && Number.isFinite(coverTopCanvasY))) {
    throw new Error(
      `Keeping a marker above the sheet needs finite positions, got marker y ${markerCanvasY} and ` +
        `sheet top y ${coverTopCanvasY}`,
    );
  }
  return Math.max(0, markerCanvasY - (coverTopCanvasY - markerClearanceAboveSheetPixels));
}

/** True when the reader asked the system for less motion. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Moves the map content up just enough that the marker at markerCanvasPoint shows above the sheet,
 * when the sheet lies over that part of the map. Animated unless the reader prefers less motion.
 */
export function keepMarkerAboveSheet(
  mapView: Pick<MapView, "container" | "moveContentUp">,
  markerCanvasPoint: CanvasPoint,
  sheetElement: HTMLElement,
): void {
  const mapBox = mapView.container.getBoundingClientRect();
  const sheetBox = sheetElement.getBoundingClientRect();
  const markerClientX = mapBox.left + markerCanvasPoint.canvasX;
  const isSheetOverMarkerColumn =
    sheetBox.width > 0 &&
    sheetBox.top < mapBox.bottom &&
    markerClientX >= sheetBox.left &&
    markerClientX <= sheetBox.right;
  if (!isSheetOverMarkerColumn) {
    return; // valid path: the sheet is beside the map (desktop) or not shown, so nothing is covered
  }
  const sheetTopCanvasY = sheetBox.top - mapBox.top;
  const liftPixels = distanceToLiftAboveCover(markerCanvasPoint.canvasY, sheetTopCanvasY);
  if (liftPixels > 0) {
    mapView.moveContentUp(liftPixels, !prefersReducedMotion());
  }
}
