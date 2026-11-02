import { page } from "@vitest/browser/context";
import { afterEach, describe, expect, it } from "vitest";
import type { AreaMatchCount, AreaSummary } from "../domain/area";
import { areaHintText, renderAreaInspector } from "./inspector";
import { legendEntries } from "./legend";
import { fixtureEventConfig, fixtureMatches } from "./overviewTestFixtures";
// The app's styles, which hide each swatch's marker label from view but not from screen readers.
import "./theme.css";
import "./overviewPanel.css";

// Runs in headless Chromium (vitest.workspace.ts "browser" project): each "Replay a match here" row
// shows a second line of marker swatches with that match's counts in the area.

const mountedRoots: HTMLElement[] = [];

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    root.remove();
  }
});

/** Renders the inspector with every marker type listed, and records each replayed match id. */
function renderRows(matchesToReplay: readonly AreaMatchCount[]): {
  root: HTMLElement;
  replayedMatchIds: string[];
} {
  const root = document.createElement("div");
  document.body.appendChild(root);
  mountedRoots.push(root);
  const areaSummary: AreaSummary = {
    countsByMarker: {},
    matchIdsPassingThrough: matchesToReplay.map((matchCount) => matchCount.matchId),
    matchesToReplay,
  };
  const replayedMatchIds: string[] = [];
  renderAreaInspector(
    root,
    areaSummary,
    legendEntries(fixtureEventConfig, "all"),
    fixtureMatches,
    (matchId) => replayedMatchIds.push(matchId),
    areaHintText,
  );
  return { root, replayedMatchIds };
}

function requireRowButton(root: HTMLElement, matchId: string): HTMLButtonElement {
  const rowButton = root.querySelector<HTMLButtonElement>(
    `.replay-match-button[data-match-id="${matchId}"]`,
  );
  if (rowButton === null) {
    throw new Error(`No "Replay a match here" row for match "${matchId}"`);
  }
  return rowButton;
}

describe("Replay a match here row breakdown", () => {
  it("shows a swatch and count for each non-zero type, in legend order", () => {
    const { root } = renderRows([
      {
        matchId: "late",
        eventCountInArea: 6,
        countsByMarker: { loot: 2, bot_kill: 1, kill_bot: 3 },
      },
    ]);
    const rowButton = requireRowButton(root, "late");
    const label = rowButton.querySelector(".replay-match-label");
    expect(label?.textContent).toBe("Feb 11 · 08:53 UTC · 6 events");
    const breakdownItems = [
      ...rowButton.querySelectorAll(".replay-match-breakdown > .replay-match-marker"),
    ];
    expect(breakdownItems.map((item) => item.querySelector(".marker-count")?.textContent)).toEqual([
      "3",
      "2",
      "1",
    ]);
    expect(breakdownItems.map((item) => item.querySelectorAll("canvas").length)).toEqual([1, 1, 1]);
    expect(breakdownItems.map((item) => item.getAttribute("data-marker-key"))).toEqual([
      "kill_bot",
      "loot",
      "bot_kill",
    ]);
  });

  it("names the row button with the whole breakdown for screen readers", () => {
    renderRows([
      { matchId: "late", eventCountInArea: 4, countsByMarker: { loot: 1, kill_bot: 3 } },
    ]);
    const rowButton = page
      .getByRole("button", {
        name: "Feb 11 · 08:53 UTC · 4 events Player killed a bot: 3 Player looted: 1",
        exact: true,
      })
      .element();
    expect(rowButton.getAttribute("data-match-id")).toBe("late");
  });

  it("gives a 0-event row no swatch line", () => {
    const { root } = renderRows([
      { matchId: "late", eventCountInArea: 1, countsByMarker: { loot: 1 } },
      { matchId: "early", eventCountInArea: 0, countsByMarker: {} },
    ]);
    expect(requireRowButton(root, "early").querySelector(".replay-match-breakdown")).toBeNull();
    expect(requireRowButton(root, "early").textContent).toBe("Feb 10 · 10:40 UTC · 0 events");
  });

  it("still opens Replay on the row's match when pressed", () => {
    const { root, replayedMatchIds } = renderRows([
      { matchId: "late", eventCountInArea: 3, countsByMarker: { kill_bot: 3 } },
      { matchId: "last", eventCountInArea: 1, countsByMarker: { storm_death: 1 } },
    ]);
    requireRowButton(root, "last").click();
    expect(replayedMatchIds).toEqual(["last"]);
  });
});
