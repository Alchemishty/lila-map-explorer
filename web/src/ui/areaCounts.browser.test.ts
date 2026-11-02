import { page } from "@vitest/browser/context";
import { afterEach, describe, expect, it } from "vitest";
import type { AreaSummary } from "../domain/area";
import { areaHintText, renderAreaInspector } from "./inspector";
import { legendEntries } from "./legend";
import { fixtureEventConfig, fixtureMatches } from "./overviewTestFixtures";
// The app's styles, which hide each swatch's marker label from view but not from screen readers.
import "./theme.css";
import "./overviewPanel.css";

// Runs in headless Chromium: the area's count per marker type as legend swatches with numbers, the
// same way the "Replay a match here" rows show theirs.

const mountedRoots: HTMLElement[] = [];

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    root.remove();
  }
});

/** Renders the inspector for an area with these counts, listing every player marker type. */
function renderAreaCounts(countsByMarker: AreaSummary["countsByMarker"]): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  mountedRoots.push(root);
  renderAreaInspector(
    root,
    { countsByMarker, matchIdsPassingThrough: [], matchesToReplay: [] },
    legendEntries(fixtureEventConfig, "player"),
    fixtureMatches,
    () => undefined,
    areaHintText,
  );
  return root;
}

function requireCountItems(root: HTMLElement): HTMLLIElement[] {
  const countList = root.querySelector("ul.area-counts");
  if (countList === null) {
    throw new Error("The area inspector shows no count list");
  }
  return [...countList.querySelectorAll<HTMLLIElement>(":scope > li")];
}

describe("area counts as legend swatches", () => {
  it("shows a drawn swatch and the count for every legend type, zeros included, in legend order", () => {
    const root = renderAreaCounts({ loot: 3, kill_bot: 1 });
    const countItems = requireCountItems(root);
    expect(countItems.map((item) => item.dataset.markerKey)).toEqual([
      "kill_player",
      "kill_bot",
      "death_by_player",
      "death_by_bot",
      "storm_death",
      "loot",
    ]);
    expect(countItems.map((item) => item.querySelector(".marker-count")?.textContent)).toEqual([
      "0",
      "1",
      "0",
      "0",
      "0",
      "3",
    ]);
    for (const item of countItems) {
      const swatch = item.querySelector("canvas");
      expect(swatch?.getAttribute("aria-hidden")).toBe("true");
    }
    // The marker labels are out of sight (1 px, clipped): what shows is each swatch and its number.
    for (const item of countItems) {
      const labelBox = item.querySelector(".marker-label-text")?.getBoundingClientRect();
      expect(labelBox?.width).toBeLessThanOrEqual(1);
    }
  });

  it("reads each count out as its full marker label and number, in a list", async () => {
    const root = renderAreaCounts({ loot: 3, kill_bot: 1 });
    await expect.element(page.getByRole("list")).toBeInTheDocument();
    // A list item takes no name from its content, so a probe button per item borrows the item's
    // text the way a screen reader reads it (aria-labelledby follows the referenced content).
    for (const [itemIndex, item] of requireCountItems(root).entries()) {
      item.id = `area-count-${itemIndex}`;
      const probeButton = document.createElement("button");
      probeButton.setAttribute("aria-labelledby", item.id);
      root.append(probeButton);
    }
    const expectedSpokenCounts = [
      "Player killed a player: 0",
      "Player killed a bot: 1",
      "Player killed by a player: 0",
      "Player killed by a bot: 0",
      "Player died to storm: 0",
      "Player looted: 3",
    ];
    for (const [itemIndex, spokenCount] of expectedSpokenCounts.entries()) {
      const probeButton = page.getByRole("button", { name: spokenCount, exact: true }).element();
      expect(probeButton.getAttribute("aria-labelledby")).toBe(`area-count-${itemIndex}`);
    }
  });
});
