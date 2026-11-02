import {
  minimumFramedSpanWorldUnits,
  widenToMinimumSpan,
  worldRectOfTracks,
} from "../domain/matchExtent";
import type { ActorTrack } from "../domain/types";
import type { ContainerInsetsCssPixels } from "../render/fitBoundsInsideInsets";
import type { MapView } from "../render/mapView";

// When a match loads in Replay, the map fits every trail point and event of the match, with a
// margin, in the part of the map the designer can see. On a phone the bottom sheet lies over the
// lower map (its handle even when closed), so the match is framed above it. The timeline is docked
// under the map, never over it. The designer may pan and zoom freely afterwards.

/** The margin (CSS px) kept between the framed match and each edge of the visible map. */
export const matchFramingMarginPixels = 32;

/** An on-screen box in CSS pixels relative to the viewport (getBoundingClientRect). */
export type ClientBox = Pick<DOMRectReadOnly, "left" | "right" | "top" | "bottom">;

/**
 * How far (CSS px) the framed match is kept inside each edge of the map at mapBox: the margin, plus
 * the part of the map the sheet at sheetBox covers. A sheet beside the map (desktop) or not shown
 * covers nothing. The margin shrinks on a map too small for it, so some room is always left.
 */
export function matchFramingInsets(
  mapBox: ClientBox,
  sheetBox: ClientBox,
): ContainerInsetsCssPixels {
  const mapWidthCssPixels = mapBox.right - mapBox.left;
  const mapHeightCssPixels = mapBox.bottom - mapBox.top;
  const isSheetOverMap =
    sheetBox.right > sheetBox.left &&
    sheetBox.left < mapBox.right &&
    sheetBox.right > mapBox.left &&
    sheetBox.top < mapBox.bottom &&
    sheetBox.bottom > mapBox.top;
  const coveredHeightCssPixels = isSheetOverMap
    ? mapBox.bottom - Math.max(sheetBox.top, mapBox.top)
    : 0;
  const marginCssPixels = Math.min(
    matchFramingMarginPixels,
    mapWidthCssPixels / 4,
    (mapHeightCssPixels - coveredHeightCssPixels) / 4,
  );
  if (!(marginCssPixels > 0)) {
    throw new Error(
      `The map has no visible room to frame the match in: it is ${mapWidthCssPixels} × ` +
        `${mapHeightCssPixels} CSS px and the panels cover ${coveredHeightCssPixels} of its height`,
    );
  }
  return {
    topCssPixels: marginCssPixels,
    rightCssPixels: marginCssPixels,
    bottomCssPixels: marginCssPixels + coveredHeightCssPixels,
    leftCssPixels: marginCssPixels,
  };
}

/** Fits the map to every row of the shown tracks, clear of the sheet over the map. */
export function frameMatchOnMap(
  mapView: Pick<MapView, "container" | "fitWorldRect">,
  sheetElement: HTMLElement,
  shownTracks: readonly ActorTrack[],
  matchId: string,
): void {
  const matchRect = widenToMinimumSpan(
    worldRectOfTracks(shownTracks, matchId),
    minimumFramedSpanWorldUnits,
  );
  mapView.fitWorldRect(
    matchRect,
    matchFramingInsets(
      mapView.container.getBoundingClientRect(),
      sheetElement.getBoundingClientRect(),
    ),
  );
}
