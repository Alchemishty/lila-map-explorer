import type { DataLoader } from "../data/loader";
import { selectMatches } from "../domain/filters";
import type { MapEvent } from "../domain/events";
import type { DayFile, Manifest, MarkerStyle, MatchSummary } from "../domain/types";
import type { MapView } from "../render/mapView";
import { emptySceneLayers, type Scene, type SceneMarker } from "../render/scene";
import { attachAreaSelection } from "./areaSelection";
import type { BottomSheet } from "./bottomSheet";
import { createHeatmapChoiceFieldset } from "./heatmapChoiceFieldset";
import { areaHintTextFor, renderAreaInspector } from "./inspector";
import { legendEntries } from "./legend";
import { createMarkerSwitches } from "./markerSwitches";
import { botOnlyMarkerKeys } from "./markerVisibility";
import { countBotDataMatches, createOverviewModelBuilder } from "./overviewModel";
import type { AppState } from "./stateTransitions";

// The Overview panel: layer switches, legend and area inspector. It loads the day files the filter
// needs, builds the model and hands the map its layers through scene.setLayers. Pressing Select
// area closes the phone sheet so the whole map is free; the end of an area drag brings the area's
// result into view (on a phone, by opening the sheet on it).

export interface OverviewPanelOptions {
  readonly manifest: Manifest;
  readonly loader: DataLoader;
  readonly scene: Scene;
  readonly mapView: MapView;
  readonly onChange: (patch: Partial<AppState>) => void;
  /** Called with a plain message when data fails to load or breaks the contract. */
  readonly onLoadFailure: (message: string) => void;
  /** True on touch screens with no hover, which have no Shift key for the area hint's Shift-drag. */
  readonly isTouchWithoutHover: boolean;
  /** The panel area holding this panel: the side panel, or the phone's bottom sheet. */
  readonly panelArea: Pick<BottomSheet, "collapse" | "reveal">;
}

export interface OverviewPanel {
  readonly element: HTMLElement;
  showState(state: AppState): void;
}

export const overviewLoadingMessage = "Loading…";

export function formatBotEventsLabel(selectedMatches: readonly MatchSummary[]): string {
  return `Bot events (${countBotDataMatches(selectedMatches)} of ${selectedMatches.length} matches have bot data)`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createSection(headingText: string): { section: HTMLElement; bodyElement: HTMLElement } {
  const section = document.createElement("section");
  section.className = "panel-section";
  const heading = document.createElement("h2");
  heading.textContent = headingText;
  const bodyElement = document.createElement("div");
  section.append(heading, bodyElement);
  return { section, bodyElement };
}

export function createOverviewPanel(options: OverviewPanelOptions): OverviewPanel {
  const { manifest, loader, scene, mapView, onChange, onLoadFailure, isTouchWithoutHover } =
    options;
  const { panelArea } = options;
  const buildModel = createOverviewModelBuilder();
  let latestState: AppState | null = null;
  function requireLatestState(): AppState {
    if (latestState === null) {
      throw new Error("The Overview panel was used before it was shown any state");
    }
    return latestState;
  }
  const patchOverview = (overviewPatch: Partial<AppState["overview"]>): void => {
    const state = requireLatestState();
    onChange({ overview: { ...state.overview, ...overviewPatch } });
  };

  const panelElement = document.createElement("div");
  panelElement.className = "overview-panel";
  const statusElement = document.createElement("p");
  statusElement.className = "overview-status";
  statusElement.setAttribute("role", "status");

  const layers = createSection("Layers");
  const heatmapFieldset = createHeatmapChoiceFieldset((heatmapKind) =>
    patchOverview({ heatmapKind }),
  );
  const heatmapScale = heatmapFieldset.scale;
  layers.bodyElement.append(heatmapFieldset.element);

  const legend = createSection("Legend");
  const markerSwitches = createMarkerSwitches(manifest.eventConfig, (visibleMarkerKeys) =>
    patchOverview({ visibleMarkerKeys }),
  );
  legend.bodyElement.append(markerSwitches.element);
  const botMarkerKeys = new Set(botOnlyMarkerKeys(manifest.eventConfig));
  const inspector = createSection("Area");
  const selectAreaButton = document.createElement("button");
  selectAreaButton.type = "button";
  selectAreaButton.className = "select-area-button";
  selectAreaButton.textContent = "Select area";
  const inspectorContent = document.createElement("div");
  inspector.bodyElement.append(selectAreaButton, inspectorContent);
  panelElement.append(statusElement, layers.section, legend.section, inspector.section);

  const areaSelection = attachAreaSelection(
    mapView,
    (area) => {
      const state = requireLatestState();
      if (state.appMode !== "overview") {
        return; // valid path: area selection belongs to Overview; Replay ignores drags and taps
      }
      if (area === null && state.overview.selectedArea === null) {
        return; // valid path: a tap with no area selected has nothing to clear
      }
      patchOverview({ selectedArea: area });
    },
    () => {
      if (requireLatestState().appMode === "overview") {
        panelArea.reveal(inspector.section);
      }
    },
  );
  let isSelectingArea = false;
  function setSelectingArea(isSelecting: boolean): void {
    isSelectingArea = isSelecting;
    selectAreaButton.setAttribute("aria-pressed", String(isSelecting));
    areaSelection.setSelecting(isSelecting);
  }
  selectAreaButton.addEventListener("click", () => {
    setSelectingArea(!isSelectingArea);
    if (isSelectingArea) {
      panelArea.collapse();
    }
  });
  setSelectingArea(false);

  // Day files: the ones the selected matches need, loaded in parallel. Stale loads are ignored.
  let loadedDayFileKey: string | null = null;
  let loadedDayFiles: readonly DayFile[] = [];
  let loadingDayFileKey: string | null = null;

  let markerLayerSource: readonly MapEvent[] | null = null;
  let markerLayer: readonly SceneMarker[] = [];
  function sceneMarkersFor(markers: readonly MapEvent[]): readonly SceneMarker[] {
    if (markers !== markerLayerSource) {
      markerLayer = markers.map((mapEvent) => ({
        event: mapEvent,
        style: requireMarkerStyle(mapEvent.markerKey),
      }));
      markerLayerSource = markers;
    }
    return markerLayer;
  }
  function requireMarkerStyle(markerKey: string): MarkerStyle {
    const style = Object.hasOwn(manifest.eventConfig.markers, markerKey)
      ? manifest.eventConfig.markers[markerKey]
      : undefined;
    if (style === undefined) {
      throw new Error(`Marker "${markerKey}" has no style in eventConfig (manifest.json)`);
    }
    return style;
  }

  function showModel(state: AppState): void {
    const model = buildModel(state, manifest, loadedDayFiles);
    statusElement.textContent = model.emptyMessage === null ? "" : model.emptyMessage;
    statusElement.hidden = model.emptyMessage === null;
    const { visibleMarkerKeys } = state.overview;
    renderAreaInspector(
      inspectorContent,
      model.areaSummary,
      // Every player type, plus each bot type only while it is switched on.
      legendEntries(manifest.eventConfig, "all").filter(
        (entry) => !botMarkerKeys.has(entry.markerKey) || visibleMarkerKeys.has(entry.markerKey),
      ),
      model.selectedMatches,
      (matchId) => {
        onChange({ appMode: "replay", replay: { ...requireLatestState().replay, matchId } });
      },
      areaHintTextFor(isTouchWithoutHover),
    );
    heatmapScale.showState(
      state.overview.heatmapKind,
      model.heatmapTotal,
      model.heatmapColorTop !== null && model.heatmapColorTop.isRaisedToMinimum,
    );
    scene.setLayers({
      heatGrid: model.smoothedHeatGrid,
      heatColorTopValue: model.heatmapColorTop === null ? null : model.heatmapColorTop.topValue,
      trails: [],
      markers: sceneMarkersFor(model.markers),
      selectionArea: model.areaSummary === null ? null : state.overview.selectedArea,
    });
  }

  function showLoading(): void {
    statusElement.textContent = overviewLoadingMessage;
    statusElement.hidden = false;
    heatmapScale.showState(null, null, false); // the old total no longer matches the emptied map
    scene.setLayers(emptySceneLayers);
  }

  function loadDayFiles(dayFileKey: string, dayFilePaths: readonly string[]): void {
    loadingDayFileKey = dayFileKey;
    Promise.all(dayFilePaths.map((dayFilePath) => loader.loadDayFile(dayFilePath))).then(
      (dayFiles) => {
        if (loadingDayFileKey !== dayFileKey) {
          return; // valid path: the filters changed while loading; a newer load is running
        }
        loadingDayFileKey = null;
        loadedDayFileKey = dayFileKey;
        loadedDayFiles = dayFiles;
        const state = requireLatestState();
        if (state.appMode === "overview") {
          showModelOrFail(state);
        }
      },
      (error: unknown) => onLoadFailure(describeError(error)),
    );
  }

  function showModelOrFail(state: AppState): void {
    try {
      showModel(state);
    } catch (error) {
      onLoadFailure(describeError(error));
    }
  }

  return {
    element: panelElement,
    showState: (state) => {
      latestState = state;
      panelElement.hidden = state.appMode !== "overview";
      if (state.appMode !== "overview") {
        if (isSelectingArea) {
          setSelectingArea(false); // Replay pans with every drag
        }
        return;
      }
      const { overview } = state;
      heatmapFieldset.showChoice(overview.heatmapKind);

      // The switches need no day files, so they work while the first load is still running.
      const selectedMatches = selectMatches(manifest.matches, state.filter);
      markerSwitches.showState(
        overview.visibleMarkerKeys,
        "all",
        formatBotEventsLabel(selectedMatches),
      );
      const dayFilePaths = [...new Set(selectedMatches.map((match) => match.dayFile))].sort();
      const dayFileKey = dayFilePaths.join("\n");
      if (dayFileKey === loadedDayFileKey) {
        loadingDayFileKey = null; // a load still running for other days is now stale
        showModelOrFail(state);
      } else if (dayFilePaths.length === 0) {
        loadingDayFileKey = null;
        loadedDayFileKey = dayFileKey;
        loadedDayFiles = [];
        showModelOrFail(state);
      } else {
        showLoading();
        if (dayFileKey !== loadingDayFileKey) {
          loadDayFiles(dayFileKey, dayFilePaths);
        }
      }
    },
  };
}
