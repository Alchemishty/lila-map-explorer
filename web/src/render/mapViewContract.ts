import type { CanvasPoint, MapConfig, WorldPoint, WorldRect } from "../domain/types";
import type { ContainerInsetsCssPixels } from "./fitBoundsInsideInsets";

/** A view to come back to: where the map was centred, in world space, and its zoom level. */
export interface SavedMapView {
  readonly mapId: string;
  readonly centerWorld: WorldPoint;
  readonly zoomLevel: number;
}

/**
 * Leaflet pan and zoom over one minimap image. worldToCanvasPoint and canvasPointToWorld are the
 * only crossings between world and canvas space (enforcement/coordinate-spaces.md). Canvas points are
 * CSS pixels relative to the container, so convert again after every move: never cache them.
 */
export interface MapView {
  /** The element Leaflet fills; the canvas overlay and pointer listeners attach here. */
  readonly container: HTMLElement;
  showMap(map: MapConfig): void;
  worldToCanvasPoint(point: WorldPoint): CanvasPoint;
  /**
   * The same mapping as worldToCanvasPoint for the current view, worked out once so converting
   * thousands of points costs a multiply and an add each. Valid only until the next move: get a new
   * one on every redraw.
   */
  worldToCanvasConverter(): (point: WorldPoint) => CanvasPoint;
  canvasPointToWorld(point: CanvasPoint): WorldPoint;
  /** Where a pointer or mouse event happened, in canvas space (Leaflet mouseEventToContainerPoint). */
  pointerEventToCanvasPoint(event: MouseEvent): CanvasPoint;
  /**
   * Called once each time the view settles: at the end of a pan, pinch or zoom step, after a resize
   * and after showMap. During a gesture, anchored overlay elements follow the map instead.
   */
  onRedraw(callback: () => void): void;
  /**
   * Called on every change of the view, during a gesture as well as when it settles: each frame of a
   * pan or pinch, each zoom step and each view reset. For cheap updates only (the world-position
   * readout); drawing waits for onRedraw.
   */
  onViewMove(callback: () => void): void;
  /**
   * Puts an element in a layer that moves with the map, above the minimap. Pointer events pass
   * through it to the map.
   */
  attachOverlayElement(element: HTMLElement): void;
  /**
   * Places an attached element with its top-left corner at topLeft now. Until it is anchored again,
   * it stays over that spot of the map: a pan moves it with the map and a zoom scales it about that
   * spot, so what it shows lines up with the minimap without being redrawn. Throws for an element
   * that was never attached.
   */
  anchorOverlayElement(element: HTMLElement, topLeft: CanvasPoint): void;
  /**
   * Called with a plain message naming the image URL and map when a minimap image fails to load.
   * With no callback registered, the failure throws instead (it is never silently ignored).
   */
  onImageLoadFailure(callback: (message: string) => void): void;
  /** Turns drag-to-pan off while the user drags out an area, and back on after. */
  setPanEnabled(isEnabled: boolean): void;
  /**
   * Moves the content up by distanceCssPixels, past the image's bottom edge if need be (a phone's
   * open bottom sheet covers the lower map). The extra room below lasts until releaseRoomBelowImage.
   */
  moveContentUp(distanceCssPixels: number, isAnimated: boolean): void;
  /** Makes the image the pan limit again, moving the view back inside it. */
  releaseRoomBelowImage(isAnimated: boolean): void;
  /**
   * Fits worldRect into the container less insets (margins, and a phone's sheet over the map), at
   * once. Only the view moves: the zoom-out limit stays the image's.
   */
  fitWorldRect(worldRect: WorldRect, insets: ContainerInsetsCssPixels): void;
  /** The view now (its centre and zoom) on the minimap shown, to come back to with restoreView. */
  saveView(): SavedMapView;
  /** Puts back, at once, a view saved on the minimap shown now. Throws for another minimap's view. */
  restoreView(view: SavedMapView): void;
  /** Fits the whole minimap in the container at once, as showMap does. */
  showWholeMap(): void;
}
