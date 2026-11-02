import { assignActorColors, type ActorTrailColor } from "../domain/actorColors";
import { deriveEvents, type MapEvent } from "../domain/events";
import {
  eventsUpTo,
  timelineTicks,
  trailUpTo,
  type PlaybackState,
  type TimelineTick,
} from "../domain/playback";
import { trailHeadStateAt } from "../domain/trailHeadState";
import type { ActorTrack, DayFile, Manifest, MatchSummary } from "../domain/types";
import type { SceneTrail } from "../render/scene";
import { summarizeFollowedActor, type FollowedActorSummary } from "./followedActorSummary";
import { requireKnownMarkerKeys, visibleMarkerEvents } from "./markerVisibility";
import type { AppState } from "./stateTransitions";

// Replay's view model: one match's actors, trails, markers and timeline at the playback clock.
// Pure, so it is tested in Node (replay.test.ts).

export const noBotFilesNoteText =
  "No bot tracks were recorded. Player events involving bots are still shown.";

export interface ReplayModel {
  /** The replayed match, or null when no match is selected. */
  readonly match: MatchSummary | null;
  /** Every actor of the match, bots removed when shouldHideBots is on. */
  readonly tracks: readonly ActorTrack[];
  /** Trail color of every actor of the match (hidden bots included), keyed by actorKey. */
  readonly colors: ReadonlyMap<string, ActorTrailColor>;
  /** The shown events at or before the clock, in the order they happened. */
  readonly visibleEvents: readonly MapEvent[];
  /** One tick per shown event of the whole match, in time order. */
  readonly ticks: readonly TimelineTick[];
  /** noBotFilesNoteText when the match has no bot files, otherwise null. */
  readonly noBotFilesNote: string | null;
  /** Null when no actor is followed, or the followed bot is hidden by shouldHideBots. */
  readonly followedActorSummary: FollowedActorSummary | null;
  /** One trail per shown actor, in track order, styled for following. */
  readonly trails: readonly SceneTrail[];
}

const emptyReplayModel: ReplayModel = {
  match: null,
  tracks: [],
  colors: new Map(),
  visibleEvents: [],
  ticks: [],
  noBotFilesNote: null,
  followedActorSummary: null,
  trails: [],
};

function requireMatchSummary(manifest: Manifest, matchId: string): MatchSummary {
  const match = manifest.matches.find((candidate) => candidate.matchId === matchId);
  if (match === undefined) {
    throw new Error(`Match "${matchId}" is replayed, but manifest.json does not list it`);
  }
  return match;
}

function requireMatchTracks(match: MatchSummary, dayFile: DayFile | null): readonly ActorTrack[] {
  if (dayFile === null) {
    throw new Error(
      `Match "${match.matchId}" is replayed, but its day file ${match.dayFile} was not given`,
    );
  }
  const dayFileMatch = dayFile.matches.find((candidate) => candidate.matchId === match.matchId);
  if (dayFileMatch === undefined) {
    throw new Error(
      `Match "${match.matchId}" is listed in manifest.json but its rows were not found in ` +
        `${match.dayFile}`,
    );
  }
  return dayFileMatch.actors;
}

function requirePlayback(state: AppState, match: MatchSummary): PlaybackState {
  if (state.replay.playback === null) {
    throw new Error(`Match "${match.matchId}" is replayed, but it has no playback clock`);
  }
  return state.replay.playback;
}

/**
 * The followed actor's track if it is shown. A followed bot hidden by shouldHideBots is a valid state
 * (showing bots again follows it again), so it gives null; a key not in the match throws.
 */
function findShownFollowedTrack(
  followedActorKey: string | null,
  match: MatchSummary,
  allTracks: readonly ActorTrack[],
  shownTracks: readonly ActorTrack[],
): ActorTrack | null {
  if (followedActorKey === null) {
    return null; // valid path: nobody is followed
  }
  if (!allTracks.some((track) => track.actorKey === followedActorKey)) {
    throw new Error(
      `Actor "${followedActorKey}" is followed, but match "${match.matchId}" has no such actor`,
    );
  }
  const shownTrack = shownTracks.find((track) => track.actorKey === followedActorKey);
  return shownTrack === undefined ? null : shownTrack;
}

function requireTrailColor(
  colors: ReadonlyMap<string, ActorTrailColor>,
  actorKey: string,
): ActorTrailColor {
  const trailColor = colors.get(actorKey);
  if (trailColor === undefined) {
    throw new Error(`Actor "${actorKey}" has no trail color`);
  }
  return trailColor;
}

/** The part of the model that does not change with the clock or the followed actor. */
interface ReplayMatchLayers {
  readonly match: MatchSummary;
  readonly allTracks: readonly ActorTrack[];
  readonly tracks: readonly ActorTrack[];
  readonly colors: ReadonlyMap<string, ActorTrailColor>;
  /** Every shown event of the match (bot-performed ones removed when shouldHideBots is on). */
  readonly shownEvents: readonly MapEvent[];
  /** The shown events whose marker type is switched on: the markers and ticks drawn. */
  readonly markerEvents: readonly MapEvent[];
  readonly ticks: readonly TimelineTick[];
}

interface ReplayMatchInputs {
  readonly manifest: Manifest;
  readonly matchId: string;
  readonly shouldHideBots: boolean;
  readonly visibleMarkerKeys: ReadonlySet<string>;
  readonly dayFile: DayFile | null;
}

function buildMatchLayers(inputs: ReplayMatchInputs): ReplayMatchLayers {
  const { manifest, matchId, shouldHideBots, visibleMarkerKeys, dayFile } = inputs;
  const match = requireMatchSummary(manifest, matchId);
  const allTracks = requireMatchTracks(match, dayFile);
  const allEvents = deriveEvents(allTracks, match.matchId, manifest.eventConfig);
  const shownEvents = shouldHideBots
    ? allEvents.filter((mapEvent) => !mapEvent.isPerformedByBot)
    : allEvents;
  const markerEvents = visibleMarkerEvents(shownEvents, visibleMarkerKeys);
  return {
    match,
    allTracks,
    tracks: shouldHideBots ? allTracks.filter((track) => track.isPlayer) : allTracks,
    colors: assignActorColors(allTracks),
    shownEvents,
    markerEvents,
    ticks: timelineTicks(markerEvents, match),
  };
}

function combineLayersAndClock(
  layers: ReplayMatchLayers,
  state: AppState,
  manifest: Manifest,
): ReplayModel {
  const { match, allTracks, tracks, colors, shownEvents, markerEvents } = layers;
  const playback = requirePlayback(state, match);
  const visibleEvents = eventsUpTo(
    markerEvents,
    playback.elapsedSeconds,
    match.startTimestampSeconds,
  );
  const followedTrack = findShownFollowedTrack(
    state.replay.followedActorKey,
    match,
    allTracks,
    tracks,
  );

  const trails = tracks.map((track): SceneTrail => {
    const trailColor = requireTrailColor(colors, track.actorKey);
    const trailUpToNow = trailUpTo(track, playback.elapsedSeconds, match.startTimestampSeconds);
    const isFollowed = followedTrack !== null && followedTrack.actorKey === track.actorKey;
    return {
      actorKey: track.actorKey,
      points: trailUpToNow.points,
      headPosition: trailUpToNow.headPosition,
      headState: trailHeadStateAt(
        track,
        playback.elapsedSeconds,
        match.startTimestampSeconds,
        manifest.eventConfig,
      ),
      style: {
        color: trailColor.color,
        isDashed: trailColor.isDashed,
        isHighlighted: isFollowed,
        isDimmed: followedTrack !== null && !isFollowed,
        headShape: track.isPlayer ? "round" : "square",
      },
    };
  });

  return {
    match,
    tracks,
    colors,
    visibleEvents,
    ticks: layers.ticks,
    noBotFilesNote: match.botCount === 0 ? noBotFilesNoteText : null,
    followedActorSummary:
      followedTrack === null
        ? null
        : summarizeFollowedActor(
            followedTrack,
            trailHeadStateAt(
              followedTrack,
              playback.elapsedSeconds,
              match.startTimestampSeconds,
              manifest.eventConfig,
            ),
            // Every shown event so far, whatever the marker switches say.
            eventsUpTo(shownEvents, playback.elapsedSeconds, match.startTimestampSeconds),
          ),
    trails,
  };
}

/** Builds a ReplayModel from the same inputs as buildReplayModel. */
export type ReplayModelBuilder = (
  state: AppState,
  manifest: Manifest,
  dayFile: DayFile | null,
) => ReplayModel;

/**
 * Replay at the state's playback clock. dayFile must hold the replayed match's rows; it may be null
 * only when no match is replayed. Bot events show unless shouldHideBots is on, which hides bot trails and
 * bot-performed events but keeps players' events about bots.
 */
export function buildReplayModel(
  state: AppState,
  manifest: Manifest,
  dayFile: DayFile | null,
): ReplayModel {
  const { matchId, shouldHideBots, visibleMarkerKeys } = state.replay;
  requireKnownMarkerKeys(visibleMarkerKeys, manifest.eventConfig); // also with no match shown
  if (matchId === null) {
    return emptyReplayModel; // valid path: no match passes the filters
  }
  return combineLayersAndClock(
    buildMatchLayers({ manifest, matchId, shouldHideBots, visibleMarkerKeys, dayFile }),
    state,
    manifest,
  );
}

/**
 * A builder that remembers the match's events, colors and ticks while the manifest, match,
 * shouldHideBots, marker switches and day file are the same, so each animation frame recomputes
 * only the clock-dependent trails, visible events and summary (the timeline keeps its tick list).
 */
export function createReplayModelBuilder(): ReplayModelBuilder {
  let cachedInputs: ReplayMatchInputs | null = null;
  let cachedLayers: ReplayMatchLayers | null = null;
  return (state, manifest, dayFile) => {
    const { matchId, shouldHideBots, visibleMarkerKeys } = state.replay;
    requireKnownMarkerKeys(visibleMarkerKeys, manifest.eventConfig); // also with no match shown
    if (matchId === null) {
      return emptyReplayModel; // valid path: no match passes the filters
    }
    const inputs: ReplayMatchInputs = {
      manifest,
      matchId,
      shouldHideBots,
      visibleMarkerKeys,
      dayFile,
    };
    if (
      cachedLayers === null ||
      cachedInputs === null ||
      cachedInputs.manifest !== manifest ||
      cachedInputs.matchId !== matchId ||
      cachedInputs.shouldHideBots !== shouldHideBots ||
      cachedInputs.visibleMarkerKeys !== visibleMarkerKeys ||
      cachedInputs.dayFile !== dayFile
    ) {
      cachedLayers = buildMatchLayers(inputs);
      cachedInputs = inputs;
    }
    return combineLayersAndClock(cachedLayers, state, manifest);
  };
}
