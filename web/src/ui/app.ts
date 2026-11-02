import "@fontsource-variable/atkinson-hyperlegible-next/wght.css";
import "./theme.css";
import "./layout.css";
import "./coordinateReadout.css";
import "./layoutPhone.css";
import "./markerSwitches.css";
import "./overviewPanel.css";
import "./replayPanel.css";
import "./timeline.css";
import { createDataLoader, fetchJsonOverHttp, type DataLoader } from "../data/loader";
import type { Manifest, MapConfig } from "../domain/types";
import { createCanvasOverlay } from "../render/canvasOverlay";
import { createMapView } from "../render/mapView";
import { createScene } from "../render/scene";
import { createBottomSheet } from "./bottomSheet";
import { createClipboardWriter, createCoordinateReadout } from "./coordinateReadout";
import { renderErrorView } from "./errorView";
import { prefersReducedMotion } from "./keepMarkerAboveSheet";
import { createOverviewPanel } from "./overviewPanel";
import { createReplayPanel } from "./replayPanel";
import { createStore } from "./store";
import { createInitialAppState, transitionAppState, type AppState } from "./stateTransitions";
import { createTopBar } from "./topBar";

// The app shell: loads the manifest, then lays out the top bar, the map and the panel area, and
// keeps them in step with the state. Every state change goes through transitionAppState.

export const loadingMessage = "Loading map data…";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireMapConfig(manifest: Manifest, mapId: string): MapConfig {
  const mapConfig = manifest.maps.find((map) => map.mapId === mapId);
  if (mapConfig === undefined) {
    throw new Error(`Map "${mapId}" has no entry in manifest.json`);
  }
  return mapConfig;
}

function mountShell(root: HTMLElement, manifest: Manifest, loader: DataLoader): void {
  const shellElement = document.createElement("div");
  shellElement.className = "app-shell";
  const workspaceElement = document.createElement("main");
  workspaceElement.className = "workspace";
  const mapContainer = document.createElement("div");
  mapContainer.className = "map-container";
  // Holds the map and what floats over it (the world-position readout and its crosshair).
  const mapFrame = document.createElement("div");
  mapFrame.className = "map-frame";
  mapFrame.append(mapContainer);
  const bottomSheet = createBottomSheet();

  const store = createStore<AppState>(createInitialAppState(manifest));
  const applyPatch = (patch: Partial<AppState>): void => {
    store.setState(transitionAppState(store.getState(), patch, manifest.matches));
  };
  const topBar = createTopBar({
    mapConfigs: manifest.maps,
    matches: manifest.matches,
    onChange: applyPatch,
  });

  workspaceElement.append(mapFrame, bottomSheet.element);
  shellElement.append(topBar.element, workspaceElement);
  root.replaceChildren(shellElement);

  // Created after the container is in the page, so Leaflet measures its real size.
  const mapView = createMapView(mapContainer);
  mapView.onImageLoadFailure((message) => renderErrorView(root, message));
  // Touch screens with no hover: the readout aims with a crosshair at the map's centre instead of
  // the pointer, and the area hint leaves out Shift-drag.
  const isTouchWithoutHover = window.matchMedia("(hover: none)").matches;
  const coordinateReadout = createCoordinateReadout({
    mapView,
    isCrosshairMode: isTouchWithoutHover,
    // navigator.clipboard is typed as always there, but browsers leave it out on plain-http pages.
    writeClipboardText: createClipboardWriter(navigator.clipboard as Clipboard | undefined),
  });
  mapFrame.append(coordinateReadout.element, coordinateReadout.crosshairElement);
  const scene = createScene(mapView, createCanvasOverlay(mapView));
  const overviewPanel = createOverviewPanel({
    manifest,
    loader,
    scene,
    mapView,
    onChange: applyPatch,
    onLoadFailure: (message) => renderErrorView(root, message),
    isTouchWithoutHover,
    panelArea: bottomSheet,
  });
  const replayPanel = createReplayPanel({
    manifest,
    loader,
    scene,
    mapView,
    onChange: applyPatch,
    onLoadFailure: (message) => renderErrorView(root, message),
    panelArea: bottomSheet,
  });
  // Room made below the image to keep a tapped marker above the open sheet goes when it closes.
  bottomSheet.onCollapse(() => mapView.releaseRoomBelowImage(!prefersReducedMotion()));
  bottomSheet.contentElement.append(overviewPanel.element, replayPanel.element);
  // Docked under the map and the panel area, so the phone's bottom sheet never covers it.
  shellElement.append(replayPanel.timelineElement);

  let shownMapId: string | null = null;
  function showState(state: AppState): void {
    shellElement.dataset.mode = state.appMode;
    topBar.showState(state);
    if (state.filter.mapId !== shownMapId) {
      const mapConfig = requireMapConfig(manifest, state.filter.mapId);
      mapView.showMap(mapConfig);
      coordinateReadout.showMap(mapConfig);
      shownMapId = state.filter.mapId;
    }
    // Only the active mode's panel sets the scene's layers.
    overviewPanel.showState(state);
    replayPanel.showState(state);
  }
  store.subscribe(showState);
  showState(store.getState());
}

/**
 * Starts the app with an existing data loader. Any failure while loading or laying out shows the
 * error view in root instead of the app.
 */
export async function startAppWithLoader(root: HTMLElement, loader: DataLoader): Promise<void> {
  root.textContent = loadingMessage;
  try {
    const manifest = await loader.loadManifest();
    mountShell(root, manifest, loader);
  } catch (error) {
    renderErrorView(root, describeError(error));
  }
}

/** Starts the app, loading data over HTTP from dataBaseUrl (which ends with "/"). */
export async function startApp(root: HTMLElement, dataBaseUrl: string): Promise<void> {
  try {
    await startAppWithLoader(root, createDataLoader(dataBaseUrl, fetchJsonOverHttp));
  } catch (error) {
    renderErrorView(root, describeError(error));
  }
}
