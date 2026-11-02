import type { MapEvent } from "../domain/events";
import type { MarkerStyle, MatchSummary } from "../domain/types";
import { shortActorKey } from "./actorList";
import type { FollowedActorSummary } from "./followedActorSummary";
import { formatElapsedClock } from "./timeline";

// Replay's inspector: the tapped markers' details and the followed actor's summary.

export const sameTickRepeatNoteText =
  "Logged more than once in the same second at the same spot. May be a multi-kill.";
export const replayInspectorHintText =
  "Select a player or bot from the list, or tap its position marker, to follow it. Tap an event marker for details.";

const otherPartyTextByKind = {
  player: "a player",
  bot: "a bot",
  unknown: "not recorded",
} as const;

function describeOtherPartyRole(mapEvent: MapEvent): "Victim" | "Killer" {
  switch (mapEvent.category) {
    case "kill":
    case "bot_kill":
      return "Victim";
    case "combat_death":
    case "bot_death":
      return "Killer";
    default:
      throw new Error(
        `Marker "${mapEvent.markerKey}" has an other party but its category "${mapEvent.category}" has no known Victim/Killer role`,
      );
  }
}

/**
 * The marker inspector's lines for a tapped event: its time into the match, then the lines of
 * describeMarkerEventWithoutTime.
 */
export function describeMarkerEvent(mapEvent: MapEvent, match: MatchSummary): string[] {
  // First, so an event from another match is refused before its time is worked out.
  const linesWithoutTime = describeMarkerEventWithoutTime(mapEvent, match);
  return [
    `Time into match: ${formatElapsedClock(mapEvent.timestampSeconds - match.startTimestampSeconds)}`,
    ...linesWithoutTime,
  ];
}

/**
 * Who performed a tapped event and, for kills and deaths, whether the other party was a player, a
 * bot or not recorded (a same-second repeat also gets the multi-kill note). A stacked row uses these
 * alone, since its summary already shows the time.
 */
export function describeMarkerEventWithoutTime(mapEvent: MapEvent, match: MatchSummary): string[] {
  if (mapEvent.matchId !== match.matchId) {
    throw new Error(
      `The marker inspector for match "${match.matchId}" was given an event from match ` +
        `"${mapEvent.matchId}"`,
    );
  }
  const lines = [`${mapEvent.isPerformedByBot ? "Bot" : "Player"}: ${mapEvent.actorKey}`];
  if (mapEvent.otherParty !== "none") {
    const otherPartyRole = describeOtherPartyRole(mapEvent);
    lines.push(`${otherPartyRole}: ${otherPartyTextByKind[mapEvent.otherParty]}`);
  }
  if (mapEvent.isSameTickRepeat) {
    lines.push(sameTickRepeatNoteText);
  }
  return lines;
}

function createInspectorBlock(
  className: string,
  headingText: string,
  lines: readonly string[],
): HTMLElement {
  const blockElement = document.createElement("div");
  blockElement.className = className;
  const headingElement = document.createElement("h3");
  headingElement.textContent = headingText;
  const listElement = document.createElement("ul");
  for (const line of lines) {
    const lineElement = document.createElement("li");
    lineElement.textContent = line;
    listElement.append(lineElement);
  }
  blockElement.append(headingElement, listElement);
  return blockElement;
}

/**
 * The block for several events at one spot: "N events here", then one collapsed row per event, in
 * the given (time) order. Its summary gives the marker label and time into the match; it opens to
 * the other lines a single marker shows, without repeating the time.
 */
function createMarkerStackBlock(
  stackedEvents: readonly MapEvent[],
  match: MatchSummary,
  requireMarkerStyle: (markerKey: string) => MarkerStyle,
): HTMLElement {
  const blockElement = document.createElement("div");
  blockElement.className = "inspected-marker-stack";
  const headingElement = document.createElement("h3");
  headingElement.textContent = `${stackedEvents.length} events here`;
  blockElement.append(headingElement);
  for (const stackedEvent of stackedEvents) {
    const lines = describeMarkerEventWithoutTime(stackedEvent, match);
    const elapsedClockText = formatElapsedClock(
      stackedEvent.timestampSeconds - match.startTimestampSeconds,
    );
    const rowElement = document.createElement("details");
    const summaryElement = document.createElement("summary");
    summaryElement.textContent = `${requireMarkerStyle(stackedEvent.markerKey).label} · ${elapsedClockText}`;
    const listElement = document.createElement("ul");
    for (const line of lines) {
      const lineElement = document.createElement("li");
      lineElement.textContent = line;
      listElement.append(lineElement);
    }
    rowElement.append(summaryElement, listElement);
    blockElement.append(rowElement);
  }
  return blockElement;
}

function createInspectedMarkersBlock(
  inspectedMarkerEvents: readonly MapEvent[],
  match: MatchSummary,
  requireMarkerStyle: (markerKey: string) => MarkerStyle,
): HTMLElement {
  const [onlyEvent] = inspectedMarkerEvents;
  if (inspectedMarkerEvents.length === 1 && onlyEvent !== undefined) {
    return createInspectorBlock(
      "inspected-marker",
      requireMarkerStyle(onlyEvent.markerKey).label,
      describeMarkerEvent(onlyEvent, match),
    );
  }
  return createMarkerStackBlock(inspectedMarkerEvents, match, requireMarkerStyle);
}

export interface ReplayInspectorContent {
  readonly match: MatchSummary | null;
  /** The tapped marker and any others at its exact spot; empty when no marker is inspected. */
  readonly inspectedMarkerEvents: readonly MapEvent[];
  readonly followedActorSummary: FollowedActorSummary | null;
}

export interface ReplayInspector {
  /**
   * Replaces the container's content with the tapped markers' details, then the followed actor's
   * summary, or a hint when there is neither.
   */
  showContent(content: ReplayInspectorContent): void;
}

/**
 * Replay's inspector in the container. It is redrawn on every playback frame, so the markers' block
 * has a slot of its own and is replaced only when another list is inspected: rows the user opened
 * stay open and keep focus.
 */
export function createReplayInspector(
  container: HTMLElement,
  requireMarkerStyle: (markerKey: string) => MarkerStyle,
): ReplayInspector {
  const markersSlotElement = document.createElement("div");
  const otherBlocksSlotElement = document.createElement("div");
  container.replaceChildren(markersSlotElement, otherBlocksSlotElement);
  let shownMarkerEvents: readonly MapEvent[] = [];
  return {
    showContent: (content) => {
      const { match, inspectedMarkerEvents, followedActorSummary } = content;
      if (inspectedMarkerEvents.length > 0 && match === null) {
        throw new Error("A marker is inspected while no match is replayed");
      }
      if (inspectedMarkerEvents !== shownMarkerEvents) {
        shownMarkerEvents = inspectedMarkerEvents;
        markersSlotElement.replaceChildren(
          ...(match === null || inspectedMarkerEvents.length === 0
            ? []
            : [createInspectedMarkersBlock(inspectedMarkerEvents, match, requireMarkerStyle)]),
        );
      }
      const otherBlocks: HTMLElement[] = [];
      if (followedActorSummary !== null) {
        const actorKindText = followedActorSummary.isPlayer ? "Player" : "Bot";
        otherBlocks.push(
          createInspectorBlock(
            "followed-actor",
            `${actorKindText} ${shortActorKey(followedActorSummary.actorKey)}`,
            followedActorSummary.lines,
          ),
        );
      } else if (inspectedMarkerEvents.length === 0) {
        const hintParagraph = document.createElement("p");
        hintParagraph.className = "panel-hint";
        hintParagraph.textContent = replayInspectorHintText;
        otherBlocks.push(hintParagraph);
      }
      otherBlocksSlotElement.replaceChildren(...otherBlocks);
    },
  };
}
