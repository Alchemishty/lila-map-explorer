// Domain types shared by every layer. They mirror the pipeline's output contract
// (manifest.json and days/{mapId}/{dayUtc}.json) after parsing in contract.ts.

/** A position in game world units, as recorded in the telemetry (y is elevation and is not used). */
export interface WorldPoint {
  readonly worldX: number;
  readonly worldZ: number;
}

/** A position in pixels on the minimap image, origin at the top-left. */
export interface PixelPoint {
  readonly pixelX: number;
  readonly pixelY: number;
}

/** An axis-aligned rectangle in world units. */
export interface WorldRect {
  readonly minWorldX: number;
  readonly maxWorldX: number;
  readonly minWorldZ: number;
  readonly maxWorldZ: number;
}

/**
 * A position in CSS pixels relative to the top-left of the canvas being drawn on: the map overlay,
 * where it equals the map container's Leaflet container points, or a legend marker swatch. Every
 * on-screen drawing and hit test uses this space.
 */
export interface CanvasPoint {
  readonly canvasX: number;
  readonly canvasY: number;
}

export interface MapConfig {
  readonly mapId: string;
  /** dataBaseUrl + the manifest's imageFile. */
  readonly imageUrl: string;
  readonly imageWidthPixels: number;
  readonly imageHeightPixels: number;
  readonly worldScale: number;
  readonly worldOriginX: number;
  readonly worldOriginZ: number;
}

export type MarkerShape = "circle" | "square" | "triangle" | "diamond";
export type MarkerOutline = "solid" | "dashed";
export type OtherParty = "player" | "bot" | "none" | "unknown";

export interface MarkerStyle {
  readonly label: string;
  readonly shape: MarkerShape;
  readonly fill: string;
  /** Hex color of the cross, or "" for no cross (storm and loot). */
  readonly cross: string;
  readonly outline: MarkerOutline;
}

export interface EventRule {
  readonly category: string;
  readonly otherParty: OtherParty;
  /** Marker key in EventConfig.markers, or null for position events. */
  readonly marker: string | null;
}

/**
 * Mirrors config/event_types.json. Rules in `bot` apply to bot actors (performed by a bot);
 * the side is always taken from the section, never from a marker key's spelling.
 */
export interface EventConfig {
  readonly player: Readonly<Record<string, EventRule>>;
  readonly bot: Readonly<Record<string, EventRule>>;
  readonly markers: Readonly<Record<string, MarkerStyle>>;
}

export type ActorType = "human" | "human_misid" | "bot";

export interface MatchSummary {
  readonly matchId: string;
  readonly mapId: string;
  readonly dayUtc: string;
  readonly startTimestampSeconds: number;
  readonly durationSeconds: number;
  readonly playerCount: number;
  readonly botCount: number;
  readonly eventCountsByMarker: Readonly<Record<string, number>>;
  /** Relative to dataBaseUrl, for example "days/AmbroseValley/2026-02-10.json". */
  readonly dayFile: string;
}

export interface Manifest {
  readonly schemaVersion: 1;
  readonly generatedAtUtc: string;
  readonly maps: readonly MapConfig[];
  readonly eventConfig: EventConfig;
  /** The pipeline writes these sorted by startTimestampSeconds; the parser does not re-check it. */
  readonly matches: readonly MatchSummary[];
}

/** Every cleaned row of one actor in one match, as parallel arrays sorted by time. */
export interface ActorTrack {
  readonly actorKey: string;
  readonly userId: string;
  readonly actorType: ActorType;
  /** actorType !== "bot" (a misidentified human is still a player). */
  readonly isPlayer: boolean;
  readonly worldX: readonly number[];
  readonly worldZ: readonly number[];
  readonly timestampSeconds: readonly number[];
  readonly eventCodes: readonly string[];
  readonly isSameTickRepeat: readonly boolean[];
}

export interface DayFileMatch {
  readonly matchId: string;
  readonly actors: readonly ActorTrack[];
}

export interface DayFile {
  readonly schemaVersion: 1;
  readonly mapId: string;
  readonly dayUtc: string;
  readonly matches: readonly DayFileMatch[];
}
