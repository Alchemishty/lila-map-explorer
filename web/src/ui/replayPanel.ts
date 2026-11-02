import type { DataLoader } from "../data/loader";
import { advancePlayback, type PlaybackState } from "../domain/playback";
import type { DayFile, Manifest, MarkerStyle } from "../domain/types";
import type { MapView } from "../render/mapView";
import { emptySceneLayers, type Scene } from "../render/scene";
import { createActorList } from "./actorList";
import type { BottomSheet } from "./bottomSheet";
import { keepMarkerAboveSheet } from "./keepMarkerAboveSheet";
import { listenForMapTaps } from "./mapTaps";
import { frameMatchOnMap } from "./matchFraming";
import { createMarkerSwitches } from "./markerSwitches";
import { createReplayInspector } from "./replayInspector";
import { createReplayModelBuilder, type ReplayModel } from "./replayModel";
import type { AppState, ReplayState } from "./stateTransitions";
import { createTimeline } from "./timeline";
import { createTrailHeadKey } from "./trailHeadKey";
import { noMatchesMessage } from "./topBar";
// The Replay panel: actor list, "Hide bot tracks and bot events", legend and inspector in the panel area, and the
// timeline docked under the map. It loads the match's day file, runs the playback clock with
// requestAnimationFrame and hands the map its layers through scene.setLayers. When a match loads, the
// map is framed on it once. A marker tap brings its details into view (on a phone, by opening the
// sheet) with the marker kept above the sheet.
export interface ReplayPanelOptions {
  readonly manifest: Manifest;
  readonly loader: DataLoader;
  readonly scene: Scene;
  readonly mapView: MapView;
  readonly onChange: (patch: Partial<AppState>) => void;
  /** Called with a plain message when data fails to load or breaks the contract. */
  readonly onLoadFailure: (message: string) => void;
  /** The panel area holding this panel: the side panel, or the phone's bottom sheet. */
  readonly panelArea: Pick<BottomSheet, "element" | "reveal">;
}
export interface ReplayPanel {
  readonly element: HTMLElement;
  /** The timeline, docked under the map; hidden outside Replay. */
  readonly timelineElement: HTMLElement;
  showState(state: AppState): void;
}

export const replayLoadingMessage = "Loading…";
export const hideBotsLabel = "Hide bot tracks and bot events";
/** Taps within this distance (CSS px) of a marker or trail head hit it. */
export const replayTapRadiusPixels = 12;

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

export function createReplayPanel(options: ReplayPanelOptions): ReplayPanel {
  const { manifest, loader, scene, mapView, onChange, onLoadFailure, panelArea } = options;
  const buildModel = createReplayModelBuilder();
  let latestState: AppState | null = null;
  function requireLatestState(): AppState {
    if (latestState === null) {
      throw new Error("The Replay panel was used before it was shown any state");
    }
    return latestState;
  }
  const patchReplay = (replayPatch: Partial<ReplayState>): void => {
    onChange({ replay: { ...requireLatestState().replay, ...replayPatch } });
  };
  function requireMarkerStyle(markerKey: string): MarkerStyle {
    const style = Object.hasOwn(manifest.eventConfig.markers, markerKey)
      ? manifest.eventConfig.markers[markerKey]
      : undefined;
    if (style === undefined) {
      throw new Error(`Marker "${markerKey}" has no style in eventConfig (manifest.json)`);
    }
    return style;
  }

  const panelElement = document.createElement("div");
  panelElement.className = "replay-panel";
  const statusElement = document.createElement("p");
  statusElement.className = "replay-status";
  statusElement.setAttribute("role", "status");
  const noteElement = document.createElement("p");
  noteElement.className = "no-bot-files-note";

  const actors = createSection("Players and bots");
  const hideBotsLabelElement = document.createElement("label");
  hideBotsLabelElement.className = "checkbox-row hide-bots-switch";
  const hideBotsInput = document.createElement("input");
  hideBotsInput.type = "checkbox";
  hideBotsInput.addEventListener("change", () =>
    patchReplay({ shouldHideBots: hideBotsInput.checked }),
  );
  hideBotsLabelElement.append(hideBotsInput, document.createTextNode(hideBotsLabel));
  const actorList = createActorList({
    onFollow: (actorKey) => patchReplay({ followedActorKey: actorKey }),
  });
  const botVisibilityHint = document.createElement("p");
  botVisibilityHint.id = "bot-visibility-hint";
  botVisibilityHint.textContent = "Player events involving bots remain visible.";
  hideBotsInput.setAttribute("aria-describedby", botVisibilityHint.id);
  actors.bodyElement.append(hideBotsLabelElement, botVisibilityHint, actorList.element);
  const legend = createSection("Legend");
  const markerSwitches = createMarkerSwitches(manifest.eventConfig, (visibleMarkerKeys) =>
    patchReplay({ visibleMarkerKeys }),
  );
  legend.bodyElement.append(markerSwitches.element, createTrailHeadKey());
  const inspector = createSection("Inspector");
  const replayInspector = createReplayInspector(inspector.bodyElement, requireMarkerStyle);
  panelElement.append(
    statusElement,
    noteElement,
    inspector.section,
    actors.section,
    legend.section,
  );

  const timeline = createTimeline({
    requireMarkerStyle,
    onPlaybackChange: (playback) => patchReplay({ playback }),
  });

  // The match's day file. A load for a match the user has since left is ignored when it lands.
  let loadedDayFilePath: string | null = null;
  let loadedDayFile: DayFile | null = null;
  let loadingDayFilePath: string | null = null;

  // The match the map was last framed on; null after leaving Replay, so coming back frames again.
  let framedMatchId: string | null = null;

  // The playback clock: one animation frame at a time while playing (Review Focus 4: it stops as
  // soon as the state is not playing, for example after a match, mode or filter change).
  let animationFrameId: number | null = null;
  let lastFrameTimeMilliseconds: number | null = null;
  function stopClock(): void {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    lastFrameTimeMilliseconds = null;
  }
  function advanceClockFrame(frameTimeMilliseconds: number): void {
    animationFrameId = null;
    const playback = requireLatestState().replay.playback;
    if (playback === null) {
      throw new Error("The playback clock ran while no match is replayed");
    }
    const wallClockDeltaMilliseconds =
      lastFrameTimeMilliseconds === null ? 0 : frameTimeMilliseconds - lastFrameTimeMilliseconds;
    lastFrameTimeMilliseconds = frameTimeMilliseconds;
    patchReplay({ playback: advancePlayback(playback, wallClockDeltaMilliseconds) });
  }
  function runClock(playback: PlaybackState | null): void {
    if (playback === null || !playback.isPlaying) {
      stopClock();
    } else if (animationFrameId === null) {
      animationFrameId = requestAnimationFrame(advanceClockFrame);
    }
  }

  listenForMapTaps(mapView, (point) => {
    const state = requireLatestState();
    if (state.appMode !== "replay") {
      return; // valid path: taps in Overview belong to the area selection
    }
    const tappedMarkerEvents = scene.findMarkersNear(point, replayTapRadiusPixels);
    const [firstTappedEvent] = tappedMarkerEvents;
    if (firstTappedEvent !== undefined) {
      patchReplay({ inspectedMarkerEvents: tappedMarkerEvents });
      panelArea.reveal(inspector.section);
      // Converted after the sheet opened: the tapped events all sit at one spot.
      const markerCanvasPoint = mapView.worldToCanvasPoint(firstTappedEvent.position);
      keepMarkerAboveSheet(mapView, markerCanvasPoint, panelArea.element);
      return;
    }
    const tappedActorKey = scene.findTrailHeadNear(point, replayTapRadiusPixels);
    if (tappedActorKey !== null) {
      patchReplay({ followedActorKey: tappedActorKey, inspectedMarkerEvents: [] });
    } else if (state.replay.inspectedMarkerEvents.length > 0) {
      patchReplay({ inspectedMarkerEvents: [] }); // a tap on empty map closes the marker details
    }
  });

  function showModel(state: AppState, model: ReplayModel): void {
    statusElement.hidden = model.match !== null;
    statusElement.textContent = model.match === null ? noMatchesMessage : "";
    noteElement.hidden = model.noBotFilesNote === null;
    noteElement.textContent = model.noBotFilesNote === null ? "" : model.noBotFilesNote;
    hideBotsInput.checked = state.replay.shouldHideBots;
    actorList.showState(model.tracks, model.colors, state.replay.followedActorKey);
    const legendInclude = state.replay.shouldHideBots ? "player" : "all";
    markerSwitches.showState(state.replay.visibleMarkerKeys, legendInclude, "Bot events");
    replayInspector.showContent({
      match: model.match,
      inspectedMarkerEvents: state.replay.inspectedMarkerEvents,
      followedActorSummary: model.followedActorSummary,
    });
    timeline.showState(state.replay.playback, model.ticks);
    scene.setLayers({
      heatGrid: null,
      heatColorTopValue: null,
      trails: model.trails,
      markers: model.visibleEvents.map((mapEvent) => ({
        event: mapEvent,
        style: requireMarkerStyle(mapEvent.markerKey),
      })),
      selectionArea: null,
    });
    // Once per match, so playback, switches and the designer's own pan and zoom are left alone.
    if (model.match !== null && model.match.matchId !== framedMatchId) {
      framedMatchId = model.match.matchId;
      frameMatchOnMap(mapView, panelArea.element, model.tracks, model.match.matchId);
    }
    runClock(state.replay.playback);
  }

  function showModelOrFail(state: AppState, dayFile: DayFile | null): void {
    try {
      showModel(state, buildModel(state, manifest, dayFile));
    } catch (error) {
      stopClock();
      onLoadFailure(describeError(error));
    }
  }

  function showLoading(): void {
    stopClock();
    statusElement.textContent = replayLoadingMessage;
    statusElement.hidden = false;
    timeline.showState(null, []);
    scene.setLayers(emptySceneLayers);
  }

  function loadDayFile(dayFilePath: string): void {
    loadingDayFilePath = dayFilePath;
    loader.loadDayFile(dayFilePath).then(
      (dayFile) => {
        if (loadingDayFilePath !== dayFilePath) {
          return; // valid path: the match changed while loading; a newer load is running
        }
        loadingDayFilePath = null;
        loadedDayFilePath = dayFilePath;
        loadedDayFile = dayFile;
        const state = requireLatestState();
        if (state.appMode === "replay") {
          showModelOrFail(state, dayFile);
        }
      },
      // Even for a match the user has left: a failed fetch is broken data, so it is never ignored.
      (error: unknown) => onLoadFailure(describeError(error)),
    );
  }

  return {
    element: panelElement,
    timelineElement: timeline.element,
    showState: (state) => {
      latestState = state;
      const isReplay = state.appMode === "replay";
      panelElement.hidden = !isReplay;
      timeline.element.hidden = !isReplay;
      if (!isReplay) {
        stopClock();
        framedMatchId = null;
        return;
      }
      const matchId = state.replay.matchId;
      const match =
        matchId === null
          ? undefined
          : manifest.matches.find((candidate) => candidate.matchId === matchId);
      if (match === undefined) {
        // No match to replay, or (contract broken) one manifest.json does not list: the model
        // shows nothing for the first and throws a plain message for the second.
        loadingDayFilePath = null;
        showModelOrFail(state, null);
      } else if (match.dayFile === loadedDayFilePath) {
        loadingDayFilePath = null; // a load still running for another match is now stale
        showModelOrFail(state, loadedDayFile);
      } else {
        showLoading();
        if (match.dayFile !== loadingDayFilePath) {
          loadDayFile(match.dayFile);
        }
      }
    },
  };
}
