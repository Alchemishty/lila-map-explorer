import { heatmapColorTop, type HeatmapColorTop } from "../domain/heatmapColorTop";
import { summarizeArea, type AreaSummary } from "../domain/area";
import { botSideEvents, deriveEvents, playerSideEvents, type MapEvent } from "../domain/events";
import { selectMatches, type MatchFilter } from "../domain/filters";
import {
  countEvents,
  createHeatGrid,
  eventsForHeatmap,
  type HeatGrid,
  type HeatmapKind,
} from "../domain/heatmap";
import {
  heatGridTotal,
  heatmapSpreadWorldUnitsByKind,
  smoothHeatGrid,
} from "../domain/heatmapSmoothing";
import { accumulateTrafficSeconds } from "../domain/traffic";
import type {
  ActorTrack,
  DayFile,
  DayFileMatch,
  EventConfig,
  Manifest,
  MapConfig,
  MatchSummary,
  WorldRect,
} from "../domain/types";
import { requireKnownMarkerKeys, visibleMarkerEvents } from "./markerVisibility";
import type { AppState } from "./stateTransitions";
import { noMatchesMessage } from "./topBar";

// The Overview's view model: everything it shows, computed exactly from the rows of the selected
// matches (nothing pre-summed). Pure, so it is tested in Node (overview.test.ts).

export interface OverviewModel {
  readonly selectedMatches: readonly MatchSummary[];
  /** The chosen heatmap's exact counts, or null when the heatmap is off or no match is selected. */
  readonly heatGrid: HeatGrid | null;
  /** A smoothed copy of heatGrid, for drawing only; null with it. */
  readonly smoothedHeatGrid: HeatGrid | null;
  /** The value smoothedHeatGrid draws darkest (domain/heatmapColorTop.ts); null with it. */
  readonly heatmapColorTop: HeatmapColorTop | null;
  /**
   * The exact total behind the heatmap (events, or traffic seconds) for the colour scale: null when
   * the heatmap is off, 0 when it is on and no match is selected. Never the smoothed grid's total.
   */
  readonly heatmapTotal: number | null;
  /** The events drawn: every event whose marker type is switched on. */
  readonly markers: readonly MapEvent[];
  /** Selected matches with bot files (botCount > 0). */
  readonly botDataMatchCount: number;
  /** "No matches for these filters" when nothing is selected, otherwise null. */
  readonly emptyMessage: string | null;
  /**
   * Counts inside the selected area, or null when no area is selected: every player-side type
   * whatever the switches say, plus each bot-event type only while it is switched on.
   */
  readonly areaSummary: AreaSummary | null;
}

/** Builds an OverviewModel from the same inputs as buildOverviewModel. */
export type OverviewModelBuilder = (
  state: AppState,
  manifest: Manifest,
  dayFiles: readonly DayFile[],
) => OverviewModel;

/** The part of the model that does not depend on the selected area. */
interface OverviewLayers {
  readonly selectedMatches: readonly MatchSummary[];
  readonly heatGrid: HeatGrid | null;
  readonly smoothedHeatGrid: HeatGrid | null;
  readonly heatmapColorTop: HeatmapColorTop | null;
  readonly heatmapTotal: number | null;
  readonly playerEvents: readonly MapEvent[];
  readonly botEvents: readonly MapEvent[];
  readonly botDataMatchCount: number;
  /** Each selected match's tracks, in selectedMatches order (earliest first). */
  readonly tracksByMatch: ReadonlyMap<string, readonly ActorTrack[]>;
}

interface OverviewLayerInputs {
  readonly manifest: Manifest;
  readonly filter: MatchFilter;
  readonly heatmapKind: HeatmapKind | null;
  readonly dayFiles: readonly DayFile[];
}

/** How many of the matches have bot files (botCount > 0). */
export function countBotDataMatches(matches: readonly MatchSummary[]): number {
  return matches.filter((match) => match.botCount > 0).length;
}

function requireMapConfig(manifest: Manifest, mapId: string): MapConfig {
  const mapConfig = manifest.maps.find((map) => map.mapId === mapId);
  if (mapConfig === undefined) {
    throw new Error(`Map "${mapId}" has no entry in manifest.json`);
  }
  return mapConfig;
}

/** Each selected match's tracks from the loaded day files. A selected match not loaded throws. */
function collectTracksByMatch(
  selectedMatches: readonly MatchSummary[],
  dayFiles: readonly DayFile[],
): Map<string, readonly ActorTrack[]> {
  const loadedMatchesById = new Map<string, DayFileMatch>();
  for (const dayFile of dayFiles) {
    for (const dayFileMatch of dayFile.matches) {
      loadedMatchesById.set(dayFileMatch.matchId, dayFileMatch);
    }
  }
  const tracksByMatch = new Map<string, readonly ActorTrack[]>();
  for (const match of selectedMatches) {
    const loadedMatch = loadedMatchesById.get(match.matchId);
    if (loadedMatch === undefined) {
      throw new Error(
        `Match "${match.matchId}" is listed in manifest.json but its rows were not found in ` +
          `${match.dayFile}`,
      );
    }
    tracksByMatch.set(match.matchId, loadedMatch.actors);
  }
  return tracksByMatch;
}

function buildHeatGrid(
  heatmapKind: HeatmapKind | null,
  mapConfig: MapConfig,
  allEvents: readonly MapEvent[],
  tracksByMatch: ReadonlyMap<string, readonly ActorTrack[]>,
  manifest: Manifest,
): HeatGrid | null {
  if (heatmapKind === null) {
    return null; // valid path: the heatmap is switched off
  }
  const emptyGrid = createHeatGrid(mapConfig);
  if (heatmapKind === "traffic") {
    return accumulateTrafficSeconds(
      emptyGrid,
      [...tracksByMatch.values()].flat(),
      manifest.eventConfig,
    );
  }
  return countEvents(emptyGrid, eventsForHeatmap(heatmapKind, allEvents));
}

function buildOverviewLayers(inputs: OverviewLayerInputs): OverviewLayers {
  const { manifest, filter, heatmapKind, dayFiles } = inputs;
  const mapConfig = requireMapConfig(manifest, filter.mapId);
  const selectedMatches = selectMatches(manifest.matches, filter);
  const tracksByMatch = collectTracksByMatch(selectedMatches, dayFiles);
  const allEvents = [...tracksByMatch].flatMap(([matchId, tracks]) =>
    deriveEvents(tracks, matchId, manifest.eventConfig),
  );
  const heatGrid =
    selectedMatches.length === 0
      ? null
      : buildHeatGrid(heatmapKind, mapConfig, allEvents, tracksByMatch, manifest);
  const smoothedHeatGrid =
    heatGrid === null || heatmapKind === null
      ? null
      : smoothHeatGrid(heatGrid, heatmapSpreadWorldUnitsByKind[heatmapKind]);
  return {
    selectedMatches,
    heatGrid,
    smoothedHeatGrid,
    heatmapColorTop:
      smoothedHeatGrid === null || heatmapKind === null
        ? null
        : heatmapColorTop(smoothedHeatGrid, heatmapKind),
    heatmapTotal: heatmapKind === null ? null : heatGrid === null ? 0 : heatGridTotal(heatGrid),
    playerEvents: playerSideEvents(allEvents),
    botEvents: botSideEvents(allEvents),
    botDataMatchCount: countBotDataMatches(selectedMatches),
    tracksByMatch,
  };
}

/** What the marker switches choose: the events drawn and the events the area inspector counts. */
interface MarkerChoice {
  readonly markers: readonly MapEvent[];
  readonly countedEvents: readonly MapEvent[];
}

function chooseMarkers(
  layers: OverviewLayers,
  visibleMarkerKeys: ReadonlySet<string>,
  eventConfig: EventConfig,
): MarkerChoice {
  requireKnownMarkerKeys(visibleMarkerKeys, eventConfig);
  const visibleBotEvents = visibleMarkerEvents(layers.botEvents, visibleMarkerKeys);
  return {
    markers: [...visibleMarkerEvents(layers.playerEvents, visibleMarkerKeys), ...visibleBotEvents],
    countedEvents: [...layers.playerEvents, ...visibleBotEvents],
  };
}

function combineLayersAndArea(
  layers: OverviewLayers,
  markerChoice: MarkerChoice,
  selectedArea: WorldRect | null,
): OverviewModel {
  const hasMatches = layers.selectedMatches.length > 0;
  return {
    selectedMatches: layers.selectedMatches,
    heatGrid: layers.heatGrid,
    smoothedHeatGrid: layers.smoothedHeatGrid,
    heatmapColorTop: layers.heatmapColorTop,
    heatmapTotal: layers.heatmapTotal,
    markers: markerChoice.markers,
    botDataMatchCount: layers.botDataMatchCount,
    emptyMessage: hasMatches ? null : noMatchesMessage,
    areaSummary:
      hasMatches && selectedArea !== null
        ? summarizeArea(selectedArea, markerChoice.countedEvents, layers.tracksByMatch)
        : null,
  };
}

function areLayerInputsSame(first: OverviewLayerInputs, second: OverviewLayerInputs): boolean {
  return (
    first.manifest === second.manifest &&
    first.filter === second.filter &&
    first.heatmapKind === second.heatmapKind &&
    first.dayFiles === second.dayFiles
  );
}

/**
 * A builder that remembers the last heatmap and events and reuses them while the filter object
 * (transitionAppState keeps it when unchanged), the heatmap kind and the day-file list are the
 * same, and the chosen markers while the visible-marker set is also the same. A marker switch then
 * re-filters only the markers, and dragging out an area recomputes only the area summary.
 */
export function createOverviewModelBuilder(): OverviewModelBuilder {
  let cachedInputs: OverviewLayerInputs | null = null;
  let cachedLayers: OverviewLayers | null = null;
  let cachedMarkerKeys: ReadonlySet<string> | null = null;
  let cachedMarkerChoice: MarkerChoice | null = null;
  return (state, manifest, dayFiles) => {
    const inputs: OverviewLayerInputs = {
      manifest,
      filter: state.filter,
      heatmapKind: state.overview.heatmapKind,
      dayFiles,
    };
    if (
      cachedLayers === null ||
      cachedInputs === null ||
      !areLayerInputsSame(cachedInputs, inputs)
    ) {
      cachedLayers = buildOverviewLayers(inputs);
      cachedInputs = inputs;
      cachedMarkerChoice = null;
    }
    const { visibleMarkerKeys } = state.overview;
    if (cachedMarkerChoice === null || cachedMarkerKeys !== visibleMarkerKeys) {
      cachedMarkerChoice = chooseMarkers(cachedLayers, visibleMarkerKeys, manifest.eventConfig);
      cachedMarkerKeys = visibleMarkerKeys;
    }
    return combineLayersAndArea(cachedLayers, cachedMarkerChoice, state.overview.selectedArea);
  };
}

/**
 * The Overview for the state's filter and layer choices. dayFiles must hold the rows of every
 * selected match (extra matches are ignored); a selected match with no rows throws.
 */
export function buildOverviewModel(
  state: AppState,
  manifest: Manifest,
  dayFiles: readonly DayFile[],
): OverviewModel {
  const layers = buildOverviewLayers({
    manifest,
    filter: state.filter,
    heatmapKind: state.overview.heatmapKind,
    dayFiles,
  });
  return combineLayersAndArea(
    layers,
    chooseMarkers(layers, state.overview.visibleMarkerKeys, manifest.eventConfig),
    state.overview.selectedArea,
  );
}
