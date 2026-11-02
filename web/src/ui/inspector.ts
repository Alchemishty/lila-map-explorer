import type { AreaMatchCount, AreaSummary } from "../domain/area";
import type { MatchSummary } from "../domain/types";
import { createMarkerSwatch } from "../render/markerSwatch";
import type { LegendEntry } from "./legend";
import { formatMatchStartLabel } from "./matchPicker";

// The inspector's content for a selected Overview area: the count of each marker inside it as
// legend swatches with numbers, how many matches passed through, and "Replay a match here" as a
// list of the area's matches, most events inside first, each with its events per marker type.

export const areaHintText =
  "Shift-drag on the map, or press Select area and drag, to see what happened in an area.";
/** The hint on touch screens with no hover, which have no Shift key. */
export const touchAreaHintText =
  "Press Select area, then drag on the map to see what happened in an area.";

/** The area hint for the designer's input: touch wording when the screen has no hover. */
export function areaHintTextFor(isTouchWithoutHover: boolean): string {
  return isTouchWithoutHover ? touchAreaHintText : areaHintText;
}
export const replayMatchHereLabel = "Replay a match here";
/** Rows shown before "Show all N matches"; every match stays one press away. */
export const replayMatchListLimit = 10;

/** One marker type's events: its legend entry and how many. */
export interface MarkerCount {
  readonly entry: LegendEntry;
  readonly count: number;
}

/** One count per legend entry, in legend order. A marker absent from the summary counts 0. */
export function areaCountRows(
  areaSummary: AreaSummary,
  entries: readonly LegendEntry[],
): MarkerCount[] {
  return entries.map((entry) => {
    const count = Object.hasOwn(areaSummary.countsByMarker, entry.markerKey)
      ? areaSummary.countsByMarker[entry.markerKey]
      : undefined;
    // Absent means no event of this marker is inside the area (summarizeArea omits zeros).
    return { entry, count: count === undefined ? 0 : count };
  });
}

/** Counts matches whose player paths touch the area, with singular/plural agreement. */
export function formatPassingThrough(areaSummary: AreaSummary): string {
  const matchCount = areaSummary.matchIdsPassingThrough.length;
  return `Player paths crossed this area in ${matchCount} ${matchCount === 1 ? "match" : "matches"}`;
}

export interface ReplayMatchRow {
  readonly matchId: string;
  readonly label: string;
  /** The match's events inside the area per marker: non-zero only, in legend order. */
  readonly markerCounts: readonly MarkerCount[];
}

/**
 * One row per match, in the given order: UTC start, the match's events inside the area, and those
 * events per marker in legend order. `entries` must hold every marker the area counted.
 */
export function replayMatchRows(
  matchesToReplay: readonly AreaMatchCount[],
  matchesById: ReadonlyMap<string, MatchSummary>,
  entries: readonly LegendEntry[],
): ReplayMatchRow[] {
  return matchesToReplay.map(({ matchId, eventCountInArea, countsByMarker }) => {
    const match = matchesById.get(matchId);
    if (match === undefined) {
      throw new Error(
        `Match "${matchId}" is in the selected area but not among the selected matches`,
      );
    }
    for (const markerKey of Object.keys(countsByMarker)) {
      if (!entries.some((entry) => entry.markerKey === markerKey)) {
        throw new Error(
          `Marker "${markerKey}" has events of match "${matchId}" in the selected area but is not ` +
            "in the inspector's legend",
        );
      }
    }
    const markerCounts = entries.flatMap((entry) => {
      const count = Object.hasOwn(countsByMarker, entry.markerKey)
        ? countsByMarker[entry.markerKey]
        : undefined;
      // Absent means no event of this marker and match is inside the area (summarizeArea omits zeros).
      return count === undefined ? [] : [{ entry, count }];
    });
    const eventsText = `${eventCountInArea} ${eventCountInArea === 1 ? "event" : "events"}`;
    return { matchId, label: `${formatMatchStartLabel(match)} · ${eventsText}`, markerCounts };
  });
}

function buildDisabledReplayButton(): HTMLButtonElement {
  const replayButton = document.createElement("button");
  replayButton.type = "button";
  replayButton.className = "replay-here-button";
  replayButton.textContent = replayMatchHereLabel;
  replayButton.disabled = true;
  return replayButton;
}

/**
 * Fills itemElement with a marker type's legend swatch and its count. The swatch reads out as its
 * full marker label (hidden from view) with the count, for example "Player killed a bot: 3".
 */
function fillMarkerCount(itemElement: HTMLElement, { entry, count }: MarkerCount): void {
  itemElement.dataset.markerKey = entry.markerKey;
  const swatch = createMarkerSwatch(entry.style);
  swatch.setAttribute("aria-hidden", "true");
  const markerLabelElement = document.createElement("span");
  markerLabelElement.className = "marker-label-text";
  markerLabelElement.textContent = `${entry.style.label}:`;
  const countElement = document.createElement("span");
  countElement.className = "marker-count";
  countElement.textContent = String(count);
  itemElement.append(swatch, markerLabelElement, countElement);
}

/**
 * A wrapping line of swatch counts, so the row button's accessible name holds the whole breakdown
 * and contains its visible text. Spans, since a button holds only phrasing content.
 */
function buildMarkerBreakdown(markerCounts: readonly MarkerCount[]): HTMLSpanElement {
  const breakdownElement = document.createElement("span");
  breakdownElement.className = "replay-match-breakdown";
  for (const markerCount of markerCounts) {
    const markerElement = document.createElement("span");
    markerElement.className = "replay-match-marker";
    fillMarkerCount(markerElement, markerCount);
    breakdownElement.append(markerElement);
  }
  return breakdownElement;
}

/**
 * The area's count per marker type as a list of swatch counts, zeros included. role="list"
 * keeps the list announced in Safari, which drops it for a list styled without bullets.
 */
function buildAreaCountList(markerCounts: readonly MarkerCount[]): HTMLUListElement {
  const countList = document.createElement("ul");
  countList.className = "area-counts";
  countList.setAttribute("role", "list");
  for (const markerCount of markerCounts) {
    const countItem = document.createElement("li");
    countItem.className = "area-count";
    fillMarkerCount(countItem, markerCount);
    countList.append(countItem);
  }
  return countList;
}

function buildReplayMatchItem(
  row: ReplayMatchRow,
  onReplayMatch: (matchId: string) => void,
): HTMLLIElement {
  const rowButton = document.createElement("button");
  rowButton.type = "button";
  rowButton.className = "replay-match-button";
  rowButton.dataset.matchId = row.matchId;
  const labelElement = document.createElement("span");
  labelElement.className = "replay-match-label";
  labelElement.textContent = row.label;
  rowButton.append(labelElement);
  if (row.markerCounts.length > 0) {
    rowButton.append(buildMarkerBreakdown(row.markerCounts));
  }
  rowButton.addEventListener("click", () => onReplayMatch(row.matchId));
  const listItem = document.createElement("li");
  listItem.append(rowButton);
  return listItem;
}

function buildReplayMatchList(
  rows: readonly ReplayMatchRow[],
  onReplayMatch: (matchId: string) => void,
): HTMLUListElement {
  const matchList = document.createElement("ul");
  matchList.className = "replay-match-list";
  matchList.append(...rows.map((row) => buildReplayMatchItem(row, onReplayMatch)));
  return matchList;
}

/**
 * The heading, the first rows and, for a longer list, the rest inside a closed "Show all N
 * matches" disclosure. A native <details> keeps keyboard focus on its summary when opened.
 */
function buildReplayMatchSection(
  rows: readonly ReplayMatchRow[],
  onReplayMatch: (matchId: string) => void,
): HTMLElement[] {
  const heading = document.createElement("h3");
  heading.className = "replay-match-heading";
  heading.textContent = replayMatchHereLabel;
  const firstRowsList = buildReplayMatchList(rows.slice(0, replayMatchListLimit), onReplayMatch);
  if (rows.length <= replayMatchListLimit) {
    return [heading, firstRowsList];
  }
  const showAllDisclosure = document.createElement("details");
  showAllDisclosure.className = "show-all-matches";
  const showAllSummary = document.createElement("summary");
  showAllSummary.textContent = `Show all ${rows.length} matches`;
  showAllDisclosure.append(
    showAllSummary,
    buildReplayMatchList(rows.slice(replayMatchListLimit), onReplayMatch),
  );
  return [heading, firstRowsList, showAllDisclosure];
}

/**
 * Replaces the container's content with the area's counts, or hintText when no area is selected.
 * "Replay a match here" lists the summary's matchesToReplay; pressing a row calls onReplayMatch
 * with that match. With no match in the area it is a disabled button.
 */
export function renderAreaInspector(
  container: HTMLElement,
  areaSummary: AreaSummary | null,
  entries: readonly LegendEntry[],
  selectedMatches: readonly MatchSummary[],
  onReplayMatch: (matchId: string) => void,
  hintText: string,
): void {
  if (areaSummary === null) {
    const hintParagraph = document.createElement("p");
    hintParagraph.className = "panel-hint";
    hintParagraph.textContent = hintText;
    container.replaceChildren(hintParagraph);
    return;
  }

  const countList = buildAreaCountList(areaCountRows(areaSummary, entries));

  const passingParagraph = document.createElement("p");
  passingParagraph.className = "area-passing-through";
  passingParagraph.textContent = formatPassingThrough(areaSummary);

  const rows = replayMatchRows(
    areaSummary.matchesToReplay,
    new Map(selectedMatches.map((match) => [match.matchId, match])),
    entries,
  );
  const replayControls =
    rows.length === 0
      ? [buildDisabledReplayButton()]
      : buildReplayMatchSection(rows, onReplayMatch);
  container.replaceChildren(countList, passingParagraph, ...replayControls);
}
