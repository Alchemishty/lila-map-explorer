import type { CanvasPoint, WorldRect } from "../domain/types";
import type { MapView } from "../render/mapView";

// Area selection for the Overview inspector. It only reports areas: the rectangle is drawn by the
// scene from the state's selectedArea, so this module never draws.
// - Desktop: shift-drag with the mouse draws an area, or any drag while "Select area" is on.
// - Touch: "Select area" turns on one-finger drag and turns map panning off while it is on.
// - A tap (press and release without moving) on the map clears the area.
// - Releasing a drag that drew an area reports the final area, then that the drawing has ended.

export interface AreaSelection {
  /** Turns "Select area" mode on or off: drags then draw areas instead of panning the map. */
  setSelecting(isSelecting: boolean): void;
}

/** The parts of the map view area selection uses; MapView fits it. */
export type AreaSelectionMapView = Pick<
  MapView,
  "container" | "pointerEventToCanvasPoint" | "canvasPointToWorld" | "setPanEnabled"
>;

/** A press that moves less than this (CSS px) before release is a tap, not a drag. */
export const tapMaxMovePixels = 5;
const selectingClassName = "is-selecting-area";

interface ActivePress {
  readonly pointerId: number;
  readonly startCanvasPoint: CanvasPoint;
  /** True when this press draws an area; false when it may pan the map or be a tap. */
  readonly isDrawingArea: boolean;
}

function movedPixels(firstPoint: CanvasPoint, secondPoint: CanvasPoint): number {
  return Math.hypot(
    secondPoint.canvasX - firstPoint.canvasX,
    secondPoint.canvasY - firstPoint.canvasY,
  );
}

function isOnMapControl(event: PointerEvent): boolean {
  return event.target instanceof Element && event.target.closest(".leaflet-control") !== null;
}

export function attachAreaSelection(
  mapView: AreaSelectionMapView,
  onChange: (area: WorldRect | null) => void,
  onDrawEnd: () => void,
): AreaSelection {
  const { container } = mapView;
  let isSelectingMode = false;
  let activePress: ActivePress | null = null;

  function areaBetween(firstCorner: CanvasPoint, oppositeCorner: CanvasPoint): WorldRect {
    const firstWorldPoint = mapView.canvasPointToWorld(firstCorner);
    const oppositeWorldPoint = mapView.canvasPointToWorld(oppositeCorner);
    return {
      minWorldX: Math.min(firstWorldPoint.worldX, oppositeWorldPoint.worldX),
      maxWorldX: Math.max(firstWorldPoint.worldX, oppositeWorldPoint.worldX),
      minWorldZ: Math.min(firstWorldPoint.worldZ, oppositeWorldPoint.worldZ),
      maxWorldZ: Math.max(firstWorldPoint.worldZ, oppositeWorldPoint.worldZ),
    };
  }

  function endPress(): void {
    activePress = null;
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerCancel);
  }

  function handlePointerMove(event: PointerEvent): void {
    if (activePress === null || event.pointerId !== activePress.pointerId) {
      return; // valid path: another pointer, or a move after the press ended
    }
    if (!activePress.isDrawingArea) {
      return; // valid path: the map pans this drag
    }
    const currentCanvasPoint = mapView.pointerEventToCanvasPoint(event);
    if (movedPixels(activePress.startCanvasPoint, currentCanvasPoint) > tapMaxMovePixels) {
      onChange(areaBetween(activePress.startCanvasPoint, currentCanvasPoint));
    }
  }

  function handlePointerUp(event: PointerEvent): void {
    if (activePress === null || event.pointerId !== activePress.pointerId) {
      return; // valid path: another pointer was released
    }
    const releaseCanvasPoint = mapView.pointerEventToCanvasPoint(event);
    const isTap = movedPixels(activePress.startCanvasPoint, releaseCanvasPoint) <= tapMaxMovePixels;
    if (isTap) {
      onChange(null);
      endPress();
    } else if (activePress.isDrawingArea) {
      const drawnArea = areaBetween(activePress.startCanvasPoint, releaseCanvasPoint);
      endPress();
      onChange(drawnArea);
      onDrawEnd();
    } else {
      endPress();
    }
  }

  function handlePointerCancel(event: PointerEvent): void {
    // The browser took the gesture over (for example a pinch); the area drawn so far stays.
    if (activePress !== null && event.pointerId === activePress.pointerId) {
      endPress();
    }
  }

  // Capture phase, so an area drag is claimed before Leaflet's own handlers see the press.
  container.addEventListener(
    "pointerdown",
    (event) => {
      if (!event.isPrimary || event.button !== 0 || isOnMapControl(event)) {
        return; // valid path: second fingers, other buttons and the zoom buttons are not ours
      }
      const isDrawingArea = isSelectingMode || (event.shiftKey && event.pointerType !== "touch");
      if (isDrawingArea) {
        // No pan and no Leaflet shift-drag box zoom: preventing pointerdown suppresses the
        // mousedown that both start from.
        event.preventDefault();
        event.stopPropagation();
      }
      endPress();
      activePress = {
        pointerId: event.pointerId,
        startCanvasPoint: mapView.pointerEventToCanvasPoint(event),
        isDrawingArea,
      };
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerCancel);
    },
    { capture: true },
  );

  return {
    setSelecting: (isSelecting) => {
      isSelectingMode = isSelecting;
      mapView.setPanEnabled(!isSelecting);
      // Without this, a touch browser may take a one-finger drag for its own scrolling.
      container.style.touchAction = isSelecting ? "none" : "";
      container.classList.toggle(selectingClassName, isSelecting);
    },
  };
}
