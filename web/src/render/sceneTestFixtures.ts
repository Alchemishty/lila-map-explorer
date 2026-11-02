// Test-only fakes and layers for the scene tests; never imported by app code.
import type { MapEvent } from "../domain/events";
import { createHeatGrid } from "../domain/heatmap";
import type { CanvasPoint, MapConfig, MarkerStyle, WorldPoint } from "../domain/types";
import type { CanvasArea } from "./canvasOverlay";
import type { TrailStyle } from "./drawTrails";
import { createRecordingContext } from "./recordingContextTestFixtures";
import type { SceneLayers, SceneOverlay } from "./scene";

/** A map view whose canvas mapping is canvasX = 2·worldX + offset, canvasY = -2·worldZ, with call counters. */
export function createFakeMapView() {
  const redrawCallbacks: (() => void)[] = [];
  const fakeMapView = {
    canvasPixelsPerWorldUnit: 2,
    canvasOffsetX: 0,
    worldToCanvasPointCallCount: 0,
    converterCount: 0,
    convertWorldToCanvas: (point: WorldPoint): CanvasPoint => ({
      canvasX: point.worldX * fakeMapView.canvasPixelsPerWorldUnit + fakeMapView.canvasOffsetX,
      canvasY: -point.worldZ * fakeMapView.canvasPixelsPerWorldUnit,
    }),
    worldToCanvasPoint: (point: WorldPoint): CanvasPoint => {
      fakeMapView.worldToCanvasPointCallCount += 1;
      return fakeMapView.convertWorldToCanvas(point);
    },
    worldToCanvasConverter: (): ((point: WorldPoint) => CanvasPoint) => {
      fakeMapView.converterCount += 1;
      return fakeMapView.convertWorldToCanvas;
    },
    onRedraw: (callback: () => void): void => {
      redrawCallbacks.push(callback);
    },
    fireRedraw: (): void => redrawCallbacks.forEach((callback) => callback()),
  };
  return fakeMapView;
}

/** A 200 × 200 CSS px overlay that records draws and counts clears. */
export function createFakeOverlay(onClear: () => void): SceneOverlay & { clearCount: number } {
  const fakeOverlay = {
    context: createRecordingContext(),
    clearCount: 0,
    clear: (): CanvasArea => {
      fakeOverlay.clearCount += 1;
      onClear();
      return {
        leftCanvasX: 0,
        topCanvasY: 0,
        rightCanvasX: 200,
        bottomCanvasY: 200,
      };
    },
  };
  return fakeOverlay;
}

const testMap: MapConfig = {
  mapId: "Tiny",
  imageUrl: "data/minimaps/Tiny.jpg",
  imageWidthPixels: 100,
  imageHeightPixels: 100,
  worldScale: 100,
  worldOriginX: 0,
  worldOriginZ: 0,
};
export const lootMarker: MarkerStyle = {
  label: "Loot",
  shape: "diamond",
  fill: "#facc15",
  cross: "",
  outline: "solid",
};
const trailStyle: TrailStyle = {
  color: "#22d3ee",
  isDashed: false,
  isHighlighted: false,
  isDimmed: false,
  headShape: "round",
};

export function buildLootEvent(actorKey: string, position: WorldPoint): MapEvent {
  return {
    matchId: "match-1",
    actorKey,
    actorType: "human",
    eventCode: "Loot",
    category: "loot",
    markerKey: "loot",
    otherParty: "none",
    isPerformedByBot: false,
    position,
    timestampSeconds: 1_770_000_010,
    isSameTickRepeat: false,
  };
}

export const nearLoot = buildLootEvent("player-a", { worldX: 10, worldZ: -10 }); // canvas (20, 20)
export const farLoot = buildLootEvent("player-b", { worldX: 14, worldZ: -10 }); // canvas (28, 20)

/** A heatmap, three trails (one with no head), two markers and a selection. */
export function buildFullLayers(): SceneLayers {
  return {
    heatGrid: createHeatGrid(testMap, 4),
    heatColorTopValue: 0,
    trails: [
      {
        actorKey: "player-a",
        points: [
          { worldX: 1, worldZ: -1 },
          { worldX: 2, worldZ: -3 },
        ],
        headPosition: { worldX: 3, worldZ: -4 },
        headState: "moving",
        style: trailStyle,
      },
      {
        actorKey: "bot:7",
        points: [],
        headPosition: { worldX: 40, worldZ: -40 },
        headState: "last_seen",
        style: trailStyle,
      },
      { actorKey: "player-c", points: [], headPosition: null, headState: null, style: trailStyle },
    ],
    markers: [
      { event: farLoot, style: lootMarker },
      { event: nearLoot, style: lootMarker },
    ],
    selectionArea: { minWorldX: 5, maxWorldX: 15, minWorldZ: -20, maxWorldZ: -10 },
  };
}
