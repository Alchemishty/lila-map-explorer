import { afterEach, describe, expect, it } from "vitest";
import type { AreaMatchCount, AreaSummary } from "../domain/area";
import type { MatchSummary } from "../domain/types";
import {
  areaHintText,
  renderAreaInspector,
  replayMatchHereLabel,
  replayMatchListLimit,
  touchAreaHintText,
} from "./inspector";
import { legendEntries } from "./legend";
import { fixtureEventConfig, fixtureMatches } from "./overviewTestFixtures";

// Runs in headless Chromium (vitest.workspace.ts "browser" project): "Replay a match here" as a
// list of the area's matches.

const mountedRoots: HTMLElement[] = [];

function mountRoot(): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  mountedRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    root.remove();
  }
});

function requireElement<Found extends Element>(root: HTMLElement, selector: string): Found {
  const element = root.querySelector<Found>(selector);
  if (element === null) {
    throw new Error(`Nothing in the test root matches "${selector}"`);
  }
  return element;
}

function buildSummary(matchesToReplay: readonly AreaMatchCount[]): AreaSummary {
  return {
    countsByMarker: {},
    matchIdsPassingThrough: matchesToReplay.map((matchCount) => matchCount.matchId),
    matchesToReplay,
  };
}

/** Renders the inspector and records every match id passed to onReplayMatch. */
function renderWithRecorder(
  root: HTMLElement,
  areaSummary: AreaSummary,
  selectedMatches: readonly MatchSummary[] = fixtureMatches,
): string[] {
  const replayedMatchIds: string[] = [];
  renderAreaInspector(
    root,
    areaSummary,
    legendEntries(fixtureEventConfig, "player"),
    selectedMatches,
    (matchId) => replayedMatchIds.push(matchId),
    areaHintText,
  );
  return replayedMatchIds;
}

/** The match rows a designer can see: rows inside a closed "Show all" disclosure are hidden. */
function rowButtons(root: HTMLElement): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>(".replay-match-button")].filter((button) =>
    button.checkVisibility(),
  );
}

/** Many made-up matches, one second apart, so the list needs "Show all". */
function buildManyMatches(matchCount: number): MatchSummary[] {
  const template = fixtureMatches[0];
  if (template === undefined) {
    throw new Error("The Overview fixtures have no match to copy");
  }
  return Array.from({ length: matchCount }, (_, i) => ({
    ...template,
    matchId: `match-${i}`,
    startTimestampSeconds: template.startTimestampSeconds + i * 60,
  }));
}

describe("area inspector match list", () => {
  it("lists the matches in order with labels, and a row opens Replay on its match", () => {
    const root = mountRoot();
    const replayedMatchIds = renderWithRecorder(
      root,
      buildSummary([
        { matchId: "late", eventCountInArea: 2, countsByMarker: { loot: 2 } },
        { matchId: "early", eventCountInArea: 0, countsByMarker: {} },
      ]),
    );
    expect(requireElement(root, "h3").textContent).toBe(replayMatchHereLabel);
    expect(
      rowButtons(root).map((button) => button.querySelector(".replay-match-label")?.textContent),
    ).toEqual(["Feb 11 · 08:53 UTC · 2 events", "Feb 10 · 10:40 UTC · 0 events"]);
    expect(rowButtons(root).map((button) => button.dataset.matchId)).toEqual(["late", "early"]);
    expect(root.querySelector(".show-all-matches")).toBeNull();
    requireElement<HTMLButtonElement>(root, '.replay-match-button[data-match-id="early"]').click();
    expect(replayedMatchIds).toEqual(["early"]);
  });

  it("shows the first rows, then every match after Show all", () => {
    const root = mountRoot();
    const manyMatches = buildManyMatches(replayMatchListLimit + 3);
    const replayedMatchIds = renderWithRecorder(
      root,
      buildSummary(
        manyMatches.map((match) => ({
          matchId: match.matchId,
          eventCountInArea: 1,
          countsByMarker: { loot: 1 },
        })),
      ),
      manyMatches,
    );
    expect(rowButtons(root).map((button) => button.dataset.matchId)).toEqual(
      manyMatches.slice(0, replayMatchListLimit).map((match) => match.matchId),
    );
    const showAllSummary = requireElement<HTMLElement>(root, ".show-all-matches > summary");
    expect(showAllSummary.textContent).toBe(`Show all ${replayMatchListLimit + 3} matches`);
    showAllSummary.click();
    expect(rowButtons(root).map((button) => button.dataset.matchId)).toEqual(
      manyMatches.map((match) => match.matchId),
    );
    requireElement<HTMLButtonElement>(
      root,
      `.replay-match-button[data-match-id="match-${replayMatchListLimit + 2}"]`,
    ).click();
    expect(replayedMatchIds).toEqual([`match-${replayMatchListLimit + 2}`]);
  });

  it("shows a disabled Replay a match here control and no rows when no match is in the area", () => {
    const root = mountRoot();
    renderWithRecorder(root, buildSummary([]));
    expect(rowButtons(root)).toEqual([]);
    const replayButton = requireElement<HTMLButtonElement>(root, ".replay-here-button");
    expect(replayButton.textContent).toBe(replayMatchHereLabel);
    expect(replayButton.disabled).toBe(true);
  });

  it("throws, naming the match, when a listed match is not among the selected matches", () => {
    const root = mountRoot();
    expect(() =>
      renderWithRecorder(
        root,
        buildSummary([{ matchId: "gone", eventCountInArea: 1, countsByMarker: { loot: 1 } }]),
      ),
    ).toThrow(/"gone"/);
  });
});

describe("area inspector hint", () => {
  it("shows the hint it is given while no area is selected (touch wording on phones)", () => {
    const root = mountRoot();
    renderAreaInspector(
      root,
      null,
      legendEntries(fixtureEventConfig, "player"),
      fixtureMatches,
      () => undefined,
      touchAreaHintText,
    );
    expect(requireElement(root, ".panel-hint").textContent).toBe(touchAreaHintText);
  });
});
