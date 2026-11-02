import { afterEach, describe, expect, it } from "vitest";
import "./theme.css";
import "./layout.css";
import type { Manifest, MatchSummary } from "../domain/types";
import { formatMatchLabel } from "./matchPicker";
import { fixtureManifest } from "./overviewTestFixtures";
import { createInitialAppState, type AppState } from "./stateTransitions";
import { createTopBar, type TopBar } from "./topBar";

// Runs in headless Chromium (vitest.workspace.ts "browser" project). Both match lists sit under a
// heading for each UTC start day, in time order, and the top bar starts with the map.

const mountedElements: HTMLElement[] = [];

afterEach(() => {
  for (const mountedElement of mountedElements.splice(0)) {
    mountedElement.remove();
  }
});

function buildMatch(matchId: string, dayUtc: string, startTimestampSeconds: number): MatchSummary {
  return {
    matchId,
    mapId: "Lockdown",
    dayUtc,
    startTimestampSeconds,
    durationSeconds: 744,
    playerCount: 1,
    botCount: 0,
    eventCountsByMarker: {},
    dayFile: `days/Lockdown/${dayUtc}.json`,
  };
}

// Out of time order on purpose. "late-night" starts Feb 9 at 23:58 UTC, two minutes before Feb 10.
const groupedManifest: Manifest = {
  ...fixtureManifest,
  matches: [
    buildMatch("feb10-afternoon", "2026-02-10", 1770735600), // 2026-02-10 15:00 UTC
    buildMatch("late-night", "2026-02-09", 1770681480), // 2026-02-09 23:58 UTC
    buildMatch("feb10-midnight", "2026-02-10", 1770681660), // 2026-02-10 00:01 UTC
  ],
};

function mountTopBar(onChange: (patch: Partial<AppState>) => void = () => undefined): {
  topBar: TopBar;
  initialState: AppState;
} {
  const topBar = createTopBar({
    mapConfigs: groupedManifest.maps,
    matches: groupedManifest.matches,
    onChange,
  });
  const initialState = createInitialAppState(groupedManifest);
  topBar.showState(initialState);
  document.body.appendChild(topBar.element);
  mountedElements.push(topBar.element);
  return { topBar, initialState };
}

function replayState(initialState: AppState, matchId: string): AppState {
  return { ...initialState, appMode: "replay", replay: { ...initialState.replay, matchId } };
}

function requireElement<ElementType extends Element>(root: Element, selector: string): ElementType {
  const found = root.querySelector<ElementType>(selector);
  if (found === null) {
    throw new Error(`Nothing matches "${selector}" in the top bar`);
  }
  return found;
}

function requireMatch(matchId: string): MatchSummary {
  const match = groupedManifest.matches.find((candidate) => candidate.matchId === matchId);
  if (match === undefined) {
    throw new Error(`The test manifest has no match "${matchId}"`);
  }
  return match;
}

/** Each day group of the matches checkbox list: its accessible name and its rows' text. */
function checkboxGroupsOf(topBar: TopBar): { name: string; rows: string[] }[] {
  return [...topBar.element.querySelectorAll(".match-dropdown [role='group']")].map((group) => {
    const headingId = group.getAttribute("aria-labelledby");
    const heading = headingId === null ? null : document.getElementById(headingId);
    if (heading === null) {
      throw new Error("A match day group is not named by a heading");
    }
    return {
      name: heading.textContent,
      rows: [...group.querySelectorAll(".checkbox-row")].map((row) => row.textContent),
    };
  });
}

describe("match lists grouped by UTC start day", () => {
  it("the matches checkbox list has one named group per day, in time order", () => {
    const { topBar } = mountTopBar();
    expect(checkboxGroupsOf(topBar)).toEqual([
      { name: "Feb 9", rows: ["23:58 UTC · 12m 24s · 1 player, 0 recorded bot tracks"] },
      {
        name: "Feb 10",
        rows: [
          "00:01 UTC · 12m 24s · 1 player, 0 recorded bot tracks",
          "15:00 UTC · 12m 24s · 1 player, 0 recorded bot tracks",
        ],
      },
    ]);
  });

  it("the Replay picker has one <optgroup> per day, its options in time order", () => {
    const { topBar, initialState } = mountTopBar();
    topBar.showState(replayState(initialState, "late-night"));
    const replaySelect = requireElement<HTMLSelectElement>(
      topBar.element,
      ".replay-match-field select",
    );
    expect(
      [...replaySelect.querySelectorAll("optgroup")].map((optionGroup) => [
        optionGroup.label,
        [...optionGroup.querySelectorAll("option")].map((option) => option.value),
      ]),
    ).toEqual([
      ["Feb 9", ["late-night"]],
      ["Feb 10", ["feb10-midnight", "feb10-afternoon"]],
    ]);
    expect(replaySelect.options[0]?.textContent).toBe(
      "23:58 UTC · 12m 24s · 1 player, 0 recorded bot tracks",
    );
  });

  it("the Replay picker shows and describes the chosen match by its full label", () => {
    const { topBar, initialState } = mountTopBar();
    topBar.showState(replayState(initialState, "feb10-midnight"));
    const replaySelect = requireElement<HTMLSelectElement>(
      topBar.element,
      ".replay-match-field select",
    );
    const chosenLabel = requireElement(topBar.element, ".replay-match-chosen");
    expect(replaySelect.value).toBe("feb10-midnight");
    expect(chosenLabel.textContent).toBe(formatMatchLabel(requireMatch("feb10-midnight")));
    expect(chosenLabel.textContent).toBe(
      "Feb 10 · 00:01 UTC · 12m 24s · 1 player, 0 recorded bot tracks",
    );
    expect(replaySelect.getAttribute("aria-describedby")).toBe(chosenLabel.id);
  });

  it("the Replay picker says there are no matches when none is selected", () => {
    const { topBar, initialState } = mountTopBar();
    topBar.showState({
      ...replayState(initialState, "late-night"),
      filter: { ...initialState.filter, dayUtcSet: new Set() },
      replay: { ...initialState.replay, matchId: null },
    });
    const replaySelect = requireElement<HTMLSelectElement>(
      topBar.element,
      ".replay-match-field select",
    );
    expect(replaySelect.disabled).toBe(true);
    expect(replaySelect.querySelectorAll("optgroup")).toHaveLength(0);
    expect(requireElement(topBar.element, ".replay-match-chosen").textContent).toBe(
      "No matches for these filters",
    );
  });

  it("a grouped checkbox still changes the subset, and the list is kept in place", () => {
    const patches: Partial<AppState>[] = [];
    const { topBar, initialState } = mountTopBar((patch) => patches.push(patch));
    const lateNightCheckbox = requireElement<HTMLInputElement>(
      topBar.element,
      ".match-dropdown input[value='late-night']",
    );

    lateNightCheckbox.click();
    topBar.showState(initialState);

    expect(patches.map((patch) => patch.filter?.matchIdSet)).toEqual([
      new Set(["feb10-midnight", "feb10-afternoon"]),
    ]);
    expect(requireElement(topBar.element, ".match-dropdown input[value='late-night']")).toBe(
      lateNightCheckbox,
    );
  });
});

describe("top bar order", () => {
  it("starts with the map, then the mode switch, then the other filters", () => {
    const { topBar } = mountTopBar();
    const controlClassNames = [
      ...topBar.element.querySelectorAll(
        ".map-field, .mode-switch, .day-dropdown, .match-dropdown, .replay-match-field",
      ),
    ].map((control) => control.classList[control.classList.length - 1]);
    expect(controlClassNames).toEqual([
      "map-field",
      "mode-switch",
      "day-dropdown",
      "match-dropdown",
      "replay-match-field",
    ]);
  });
});

describe("the chosen match's label on a desktop", () => {
  it("wraps a label too long for the field instead of cutting it off, all under the select", () => {
    const longLabelManifest: Manifest = {
      ...fixtureManifest,
      matches: [
        { ...buildMatch("crowded", "2026-02-10", 1770735600), playerCount: 128, botCount: 256 },
      ],
    };
    const topBar = createTopBar({
      mapConfigs: longLabelManifest.maps,
      matches: longLabelManifest.matches,
      onChange: () => undefined,
    });
    const initialState = createInitialAppState(longLabelManifest);
    topBar.showState(replayState(initialState, "crowded"));
    document.body.appendChild(topBar.element);
    mountedElements.push(topBar.element);
    const chosenLabel = requireElement<HTMLElement>(topBar.element, ".replay-match-chosen");
    const replaySelect = requireElement<HTMLSelectElement>(
      topBar.element,
      ".replay-match-field select",
    );

    expect(chosenLabel.textContent).toBe(
      "Feb 10 · 15:00 UTC · 12m 24s · 128 players, 256 recorded bot tracks",
    );
    expect(chosenLabel.scrollWidth).toBeLessThanOrEqual(chosenLabel.clientWidth);
    expect(chosenLabel.scrollHeight).toBeLessThanOrEqual(chosenLabel.clientHeight);
    const labelBox = chosenLabel.getBoundingClientRect();
    const selectBox = replaySelect.getBoundingClientRect();
    expect(labelBox.width).toBeLessThanOrEqual(460);
    expect(labelBox.height).toBeGreaterThan(selectBox.height / 2);
    expect(selectBox.height).toBeGreaterThanOrEqual(labelBox.height);
  });
});
