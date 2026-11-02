import type { MapView } from "./mapView";

/** The part of the 2D context the draw functions use. A real CanvasRenderingContext2D satisfies it. */
export type DrawingContext = Pick<
  CanvasRenderingContext2D,
  | "save"
  | "restore"
  | "beginPath"
  | "closePath"
  | "moveTo"
  | "lineTo"
  | "arc"
  | "rect"
  | "fillRect"
  | "fill"
  | "stroke"
  | "setLineDash"
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "globalAlpha"
  | "drawImage"
  | "imageSmoothingEnabled"
  | "imageSmoothingQuality"
>;

/**
 * The part of canvas space the overlay covers at its last clear: the container plus a margin on each
 * side (so left and top are negative), in CSS pixels.
 */
export interface CanvasArea {
  readonly leftCanvasX: number;
  readonly topCanvasY: number;
  readonly rightCanvasX: number;
  readonly bottomCanvasY: number;
}

/**
 * The share of the container's width and height drawn beyond each edge, so a drag shows drawn
 * content until it ends and the overlay is redrawn. Leaflet's own canvas renderer uses 0.1.
 */
export const overlayMarginFraction = 0.1;

/** A canvas over the map container and its margin. Only render/scene.ts draws on it. */
export interface CanvasOverlay {
  readonly context: CanvasRenderingContext2D;
  /**
   * Matches the canvas to the container's current size plus margins and to the pixel ratio, anchors
   * it to the map at the current view, erases it, and returns the area it covers.
   */
  clear(): CanvasArea;
}

/**
 * The canvas lives in a map layer that moves with every pan and is scaled on every zoom, so between
 * redraws it keeps lining up with the minimap (MapView.anchorOverlayElement). The backing store is
 * cssSize × devicePixelRatio, and the context is pre-scaled by the ratio and shifted past the margin,
 * so drawing code works only in CanvasPoint CSS pixels (enforcement/coordinate-spaces.md).
 */
export function createCanvasOverlay(mapView: MapView): CanvasOverlay {
  const canvas = document.createElement("canvas");
  canvas.style.pointerEvents = "none";
  mapView.attachOverlayElement(canvas);
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("This browser cannot draw on a 2D canvas, so the map overlay cannot be shown");
  }

  return {
    context,
    clear: () => {
      const containerWidthPixels = mapView.container.clientWidth;
      const containerHeightPixels = mapView.container.clientHeight;
      // Whole CSS pixels, so a canvas at rest sits on the pixel grid and is not resampled.
      const marginXPixels = Math.round(containerWidthPixels * overlayMarginFraction);
      const marginYPixels = Math.round(containerHeightPixels * overlayMarginFraction);
      const cssWidthPixels = containerWidthPixels + 2 * marginXPixels;
      const cssHeightPixels = containerHeightPixels + 2 * marginYPixels;
      const devicePixelRatio = window.devicePixelRatio;
      const backingWidthPixels = Math.round(cssWidthPixels * devicePixelRatio);
      const backingHeightPixels = Math.round(cssHeightPixels * devicePixelRatio);
      if (canvas.width !== backingWidthPixels || canvas.height !== backingHeightPixels) {
        canvas.width = backingWidthPixels;
        canvas.height = backingHeightPixels;
      }
      canvas.style.width = `${cssWidthPixels}px`;
      canvas.style.height = `${cssHeightPixels}px`;
      mapView.anchorOverlayElement(canvas, { canvasX: -marginXPixels, canvasY: -marginYPixels });
      context.setTransform(
        devicePixelRatio,
        0,
        0,
        devicePixelRatio,
        marginXPixels * devicePixelRatio,
        marginYPixels * devicePixelRatio,
      );
      context.clearRect(-marginXPixels, -marginYPixels, cssWidthPixels, cssHeightPixels);
      return {
        leftCanvasX: -marginXPixels,
        topCanvasY: -marginYPixels,
        rightCanvasX: containerWidthPixels + marginXPixels,
        bottomCanvasY: containerHeightPixels + marginYPixels,
      };
    },
  };
}
