import { DataContractError } from "./contract";
import { addToCell, cloneHeatGrid, requireCellIndex, type HeatGrid } from "./heatmap";
import type { ActorTrack, EventConfig, WorldPoint } from "./types";

// Time-weighted traffic (docs/domain.md, "How the numbers are computed"): each interval between two consecutive waypoints of a player is
// credited as time, spread evenly along the straight line between them across the cells it
// crosses. Waypoints are the position samples plus the Loot and kill rows recorded between the
// first and last position sample, in recorded order, as in Replay's trail (user decision
// 2026-11-02). Long gaps are not capped. Rows after the player's first death are
// ignored. The last position sample adds no time, except when the first death comes later at
// exactly the same world X and Z: the player stood there until they died, so that gap counts too
// (user decision 2026-11-02). Bot tracks never enter heatmaps.

/** One row of a track, read from its parallel arrays. */
export interface TrackRow {
  readonly eventCode: string;
  readonly position: WorldPoint;
  readonly timestampSeconds: number;
}

/** A waypoint: where the actor was recorded at a time. */
interface Waypoint {
  readonly position: WorldPoint;
  readonly timestampSeconds: number;
}

/** A row that may become a waypoint, and whether it is a position sample. */
interface WaypointCandidate extends Waypoint {
  readonly isPositionSample: boolean;
}

const positionCategory = "position";
const eventWaypointCategories: ReadonlySet<string> = new Set(["loot", "kill"]);
const deathCategories: ReadonlySet<string> = new Set(["combat_death", "storm_death"]);

/** Row rowIndex of the track. Throws when the parallel arrays have different lengths. */
export function readTrackRow(
  track: ActorTrack,
  rowIndex: number,
  trackDescription: string,
): TrackRow {
  const eventCode = track.eventCodes[rowIndex];
  const worldX = track.worldX[rowIndex];
  const worldZ = track.worldZ[rowIndex];
  const timestampSeconds = track.timestampSeconds[rowIndex];
  if (
    eventCode === undefined ||
    worldX === undefined ||
    worldZ === undefined ||
    timestampSeconds === undefined ||
    track.isSameTickRepeat[rowIndex] === undefined
  ) {
    throw new DataContractError(
      `${trackDescription}: row ${rowIndex} is missing a value ` +
        "(the track's parallel arrays have different lengths)",
    );
  }
  return { eventCode, position: { worldX, worldZ }, timestampSeconds };
}

/** The number of rows, which every parallel array must share. */
export function trackRowCount(track: ActorTrack): number {
  return Math.max(
    track.eventCodes.length,
    track.worldX.length,
    track.worldZ.length,
    track.timestampSeconds.length,
    track.isSameTickRepeat.length,
  );
}

function playerRuleCategory(
  eventConfig: EventConfig,
  eventCode: string,
  trackDescription: string,
): string {
  // Own keys only, so codes such as "toString" never resolve to Object built-ins.
  const eventRule = Object.hasOwn(eventConfig.player, eventCode)
    ? eventConfig.player[eventCode]
    : undefined;
  if (eventRule === undefined) {
    throw new DataContractError(
      `${trackDescription}: event code "${eventCode}" has no rule in the player section of ` +
        "eventConfig (manifest.json). The build step should have rejected it.",
    );
  }
  return eventRule.category;
}

/**
 * The player's waypoints up to and including the time of their first death: position samples, and
 * the Loot and kill rows between the first and last of those samples in row order. When the death
 * is later than the last position sample and records exactly its world X and Z, the death is
 * appended as a final waypoint, so the stationary gap before it counts as time.
 */
function waypointsUntilDeath(track: ActorTrack, eventConfig: EventConfig): Waypoint[] {
  const trackDescription = `Actor "${track.actorKey}"`;
  const waypointCandidates: WaypointCandidate[] = [];
  // null is valid: a player who never died (no extraction event exists, so nothing is assumed).
  let firstDeathSample: Waypoint | null = null;
  for (let i = 0; i < trackRowCount(track); i++) {
    const trackRow = readTrackRow(track, i, trackDescription);
    const category = playerRuleCategory(eventConfig, trackRow.eventCode, trackDescription);
    const isPositionSample = category === positionCategory;
    if (isPositionSample || eventWaypointCategories.has(category)) {
      const previousCandidate = waypointCandidates.at(-1);
      if (
        previousCandidate !== undefined &&
        trackRow.timestampSeconds < previousCandidate.timestampSeconds
      ) {
        throw new DataContractError(
          `${trackDescription}: position, loot and kill rows are not sorted by time (row ${i} at ` +
            `${trackRow.timestampSeconds} s comes after ${previousCandidate.timestampSeconds} s)`,
        );
      }
      waypointCandidates.push({
        position: trackRow.position,
        timestampSeconds: trackRow.timestampSeconds,
        isPositionSample,
      });
    } else if (
      deathCategories.has(category) &&
      (firstDeathSample === null || trackRow.timestampSeconds < firstDeathSample.timestampSeconds)
    ) {
      firstDeathSample = {
        position: trackRow.position,
        timestampSeconds: trackRow.timestampSeconds,
      };
    }
  }
  // Infinity is valid when there is no death: every candidate is before it.
  const deathTimestampSeconds =
    firstDeathSample === null ? Infinity : firstDeathSample.timestampSeconds;
  const candidatesUpToDeath = waypointCandidates.filter(
    (candidate) => candidate.timestampSeconds <= deathTimestampSeconds,
  );
  const sampleIndexes = candidatesUpToDeath.flatMap((candidate, candidateIndex) =>
    candidate.isPositionSample ? [candidateIndex] : [],
  );
  const firstSampleIndex = sampleIndexes.at(0);
  const lastSampleIndex = sampleIndexes.at(-1);
  // No position sample is valid: there is no known path, and no spot to extend.
  const waypointsUpToDeath: Waypoint[] =
    firstSampleIndex === undefined || lastSampleIndex === undefined
      ? []
      : candidatesUpToDeath.slice(firstSampleIndex, lastSampleIndex + 1);
  const lastSample = waypointsUpToDeath.at(-1);
  if (
    firstDeathSample !== null &&
    lastSample !== undefined &&
    deathTimestampSeconds > lastSample.timestampSeconds &&
    firstDeathSample.position.worldX === lastSample.position.worldX &&
    firstDeathSample.position.worldZ === lastSample.position.worldZ
  ) {
    waypointsUpToDeath.push(firstDeathSample);
  }
  return waypointsUpToDeath;
}

/**
 * Fractions (strictly between 0 and 1) along a segment at which a coordinate measured in cells
 * crosses a whole number, that is, a grid line.
 */
function gridLineCrossingFractions(startCellPosition: number, endCellPosition: number): number[] {
  if (startCellPosition === endCellPosition) {
    return [];
  }
  const crossingFractions: number[] = [];
  const lowestGridLine = Math.ceil(Math.min(startCellPosition, endCellPosition));
  const highestGridLine = Math.floor(Math.max(startCellPosition, endCellPosition));
  for (let gridLine = lowestGridLine; gridLine <= highestGridLine; gridLine++) {
    const crossingFraction = (gridLine - startCellPosition) / (endCellPosition - startCellPosition);
    if (crossingFraction > 0 && crossingFraction < 1) {
      crossingFractions.push(crossingFraction);
    }
  }
  return crossingFractions;
}

function pointAlongSegment(start: WorldPoint, end: WorldPoint, fraction: number): WorldPoint {
  return {
    worldX: start.worldX + (end.worldX - start.worldX) * fraction,
    worldZ: start.worldZ + (end.worldZ - start.worldZ) * fraction,
  };
}

/**
 * Spreads durationSeconds over the cells the segment crosses, in proportion to the length inside
 * each cell (parametric line-grid traversal, as in Amanatides-Woo). A zero-length segment puts all
 * of it in the start cell.
 */
function addSegmentSeconds(
  trafficGrid: HeatGrid,
  start: Waypoint,
  end: Waypoint,
  trackDescription: string,
): void {
  const durationSeconds = end.timestampSeconds - start.timestampSeconds;
  const startCellIndex = requireCellIndex(
    trafficGrid,
    start.position,
    `${trackDescription}: waypoint`,
  );
  requireCellIndex(trafficGrid, end.position, `${trackDescription}: waypoint`);
  const startPoint = start.position;
  const endPoint = end.position;
  if (startPoint.worldX === endPoint.worldX && startPoint.worldZ === endPoint.worldZ) {
    addToCell(trafficGrid, startCellIndex, durationSeconds);
    return;
  }
  const cellWorldSize = trafficGrid.cellWorldSize;
  const pieceBoundaryFractions = [
    0,
    1,
    ...gridLineCrossingFractions(
      (startPoint.worldX - trafficGrid.worldOriginX) / cellWorldSize,
      (endPoint.worldX - trafficGrid.worldOriginX) / cellWorldSize,
    ),
    ...gridLineCrossingFractions(
      (startPoint.worldZ - trafficGrid.worldOriginZ) / cellWorldSize,
      (endPoint.worldZ - trafficGrid.worldOriginZ) / cellWorldSize,
    ),
  ].sort((firstFraction, secondFraction) => firstFraction - secondFraction);
  for (let i = 1; i < pieceBoundaryFractions.length; i++) {
    const pieceStartFraction = pieceBoundaryFractions[i - 1];
    const pieceEndFraction = pieceBoundaryFractions[i];
    if (pieceStartFraction === undefined || pieceEndFraction === undefined) {
      throw new Error(`Segment piece ${i} has no boundary (internal error)`);
    }
    if (pieceEndFraction <= pieceStartFraction) {
      continue; // two grid lines crossed at the same point (a cell corner): no length between them
    }
    // A piece lies inside one cell, so its midpoint names the cell without edge ambiguity.
    const pieceMidpoint = pointAlongSegment(
      startPoint,
      endPoint,
      (pieceStartFraction + pieceEndFraction) / 2,
    );
    const pieceCellIndex = requireCellIndex(
      trafficGrid,
      pieceMidpoint,
      `${trackDescription}: trail point`,
    );
    addToCell(
      trafficGrid,
      pieceCellIndex,
      durationSeconds * (pieceEndFraction - pieceStartFraction),
    );
  }
}

/**
 * A new grid: the input's values plus the seconds every player spent in each cell. Only player
 * tracks count. A waypoint off the grid, an unknown event code or waypoints out of time order throw
 * a DataContractError.
 */
export function accumulateTrafficSeconds(
  grid: HeatGrid,
  tracks: readonly ActorTrack[],
  eventConfig: EventConfig,
): HeatGrid {
  const trafficGrid = cloneHeatGrid(grid);
  for (const track of tracks) {
    if (!track.isPlayer) {
      continue; // valid path: bot tracks never enter heatmaps
    }
    const waypoints = waypointsUntilDeath(track, eventConfig);
    // 0 or 1 waypoints is valid and adds nothing: the last one never adds time by itself.
    for (let i = 1; i < waypoints.length; i++) {
      const start = waypoints[i - 1];
      const end = waypoints[i];
      if (start === undefined || end === undefined) {
        throw new Error(`Actor "${track.actorKey}": waypoint ${i} is missing (internal error)`);
      }
      addSegmentSeconds(trafficGrid, start, end, `Actor "${track.actorKey}"`);
    }
  }
  return trafficGrid;
}
