import type { CanvasPoint } from "../domain/types";
import type { MapView } from "../render/mapView";
import { tapMaxMovePixels } from "./areaSelection";

// Replay's map taps: a press on the map released without moving is a tap; a drag pans instead.

/** Calls onTap with the canvas point of every press on the map that is released without moving. */
export function listenForMapTaps(
  mapView: Pick<MapView, "container" | "pointerEventToCanvasPoint">,
  onTap: (point: CanvasPoint) => void,
): void {
  let pressStart: { pointerId: number; canvasPoint: CanvasPoint } | null = null;
  mapView.container.addEventListener("pointerdown", (event) => {
    pressStart = event.isPrimary
      ? { pointerId: event.pointerId, canvasPoint: mapView.pointerEventToCanvasPoint(event) }
      : null;
  });
  window.addEventListener("pointerup", (event) => {
    if (pressStart === null || event.pointerId !== pressStart.pointerId) {
      return; // valid path: the press started off the map, or another pointer was released
    }
    const startCanvasPoint = pressStart.canvasPoint;
    pressStart = null;
    const releaseCanvasPoint = mapView.pointerEventToCanvasPoint(event);
    const movedPixels = Math.hypot(
      releaseCanvasPoint.canvasX - startCanvasPoint.canvasX,
      releaseCanvasPoint.canvasY - startCanvasPoint.canvasY,
    );
    if (movedPixels <= tapMaxMovePixels) {
      onTap(releaseCanvasPoint);
    }
  });
}
