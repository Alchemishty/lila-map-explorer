import { page, userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it } from "vitest";
import { createHeatmapChoiceFieldset } from "./heatmapChoiceFieldset";
import { createMarkerSwitches } from "./markerSwitches";
import { fixtureEventConfig } from "./overviewTestFixtures";
import { createTrailHeadKey } from "./trailHeadKey";
// The app's styles: the Only buttons' hover rules and the trail-head key's look.
import "./theme.css";
import "./layout.css";
import "./markerSwitches.css";
import "./replayPanel.css";

// Runs in headless Chromium (a mouse screen: hover is "hover"): what keeps the side panel short.
// Only the chosen heatmap's description shows, Only buttons wait for hover or focus, and the
// Replay trail-head key folds.

const mountedElements: HTMLElement[] = [];

afterEach(() => {
  for (const element of mountedElements.splice(0)) {
    element.remove();
  }
});

function mount<Mounted extends HTMLElement>(element: Mounted): Mounted {
  document.body.appendChild(element);
  mountedElements.push(element);
  return element;
}

const descriptionsByLabel: Readonly<Record<string, string>> = {
  "Kill zones": "Where players stood when they made a kill",
  "Combat death zones": "Where players were killed by a player or a bot",
  "Storm death zones": "Where players died to the storm",
  Traffic: "Where players spent the most time",
};

describe("heatmap descriptions", () => {
  it("shows only the chosen heatmap's description, and none for Off", () => {
    const heatmapFieldset = createHeatmapChoiceFieldset(() => undefined);
    mount(heatmapFieldset.element);
    heatmapFieldset.showChoice("combatDeaths");
    const shownDescriptions = [
      ...heatmapFieldset.element.querySelectorAll<HTMLElement>(".heatmap-description"),
    ].filter((description) => description.checkVisibility());
    expect(shownDescriptions.map((description) => description.textContent)).toEqual([
      "Where players were killed by a player or a bot",
    ]);
    heatmapFieldset.showChoice(null);
    expect(
      [...heatmapFieldset.element.querySelectorAll<HTMLElement>(".heatmap-description")].filter(
        (description) => description.checkVisibility(),
      ),
    ).toEqual([]);
  });

  it("keeps every radio described by its own description, shown or hidden", () => {
    const heatmapFieldset = createHeatmapChoiceFieldset(() => undefined);
    mount(heatmapFieldset.element);
    heatmapFieldset.showChoice("kills");
    for (const [label, descriptionText] of Object.entries(descriptionsByLabel)) {
      const radio = page.getByRole("radio", { name: label, exact: true }).element();
      const descriptionId = radio.getAttribute("aria-describedby");
      if (descriptionId === null) {
        throw new Error(`The "${label}" radio has no accessible description`);
      }
      expect(document.getElementById(descriptionId)?.textContent).toBe(descriptionText);
    }
    expect(page.getByRole("radio", { name: "Off", exact: true }).element()).not.toHaveAttribute(
      "aria-describedby",
    );
  });

  it("reports the chosen heatmap when a radio is picked", async () => {
    const chosenKinds: (string | null)[] = [];
    mount(createHeatmapChoiceFieldset((heatmapKind) => chosenKinds.push(heatmapKind)).element);
    await userEvent.click(page.getByRole("radio", { name: "Traffic", exact: true }));
    await userEvent.click(page.getByRole("radio", { name: "Off", exact: true }));
    expect(chosenKinds).toEqual(["traffic", null]);
  });
});

function requireRow(root: HTMLElement, markerKey: string): HTMLElement {
  const row = root.querySelector<HTMLElement>(`.legend-entry[data-marker-key="${markerKey}"]`);
  if (row === null) {
    throw new Error(`The legend has no row for "${markerKey}"`);
  }
  return row;
}

function onlyButtonOpacity(row: HTMLElement): string {
  const onlyButton = row.querySelector(".marker-only-button");
  if (onlyButton === null) {
    throw new Error(`The legend row "${row.dataset.markerKey}" has no Only button`);
  }
  return getComputedStyle(onlyButton).opacity;
}

function mountSwitches(): HTMLElement {
  const switches = createMarkerSwitches(fixtureEventConfig, () => undefined);
  switches.showState(new Set(), "all", "Bot events");
  return mount(switches.element);
}

describe("Only buttons", () => {
  it("with a mouse, show on row hover and hide again when the pointer leaves", async () => {
    const switchesElement = mountSwitches();
    const lootRow = requireRow(switchesElement, "loot");
    expect(onlyButtonOpacity(lootRow)).toBe("0");
    await userEvent.hover(lootRow);
    expect(onlyButtonOpacity(lootRow)).toBe("1");
    expect(onlyButtonOpacity(requireRow(switchesElement, "kill_bot"))).toBe("0");
    await userEvent.unhover(lootRow);
    expect(onlyButtonOpacity(lootRow)).toBe("0");
  });

  it("show while keyboard focus is anywhere in the row, and stay in the tab order", async () => {
    const switchesElement = mountSwitches();
    const lootRow = requireRow(switchesElement, "loot");
    lootRow.querySelector("input")?.focus();
    expect(onlyButtonOpacity(lootRow)).toBe("1");
    await userEvent.tab(); // from the row's switch to its Only button
    expect(document.activeElement).toBe(lootRow.querySelector(".marker-only-button"));
    expect(onlyButtonOpacity(lootRow)).toBe("1");
    await userEvent.tab(); // on to the next row's switch
    expect(onlyButtonOpacity(lootRow)).toBe("0");
  });

  it("are hidden only under (hover: hover), so a touch screen with no hover always shows them", () => {
    // Chromium cannot emulate (hover: none); the phone e2e (WebKit, a touch screen) checks it live.
    const hidingRules = [...document.styleSheets]
      .flatMap((styleSheet) => [...styleSheet.cssRules])
      .flatMap((rule) => (rule instanceof CSSMediaRule ? [...rule.cssRules] : [rule]))
      .filter(
        (rule): rule is CSSStyleRule =>
          rule instanceof CSSStyleRule &&
          rule.selectorText.includes(".marker-only-button") &&
          rule.style.opacity === "0",
      );
    expect(hidingRules).toHaveLength(1);
    const hidingMediaRule = hidingRules[0]?.parentRule;
    expect(hidingMediaRule instanceof CSSMediaRule && hidingMediaRule.conditionText).toBe(
      "(hover: hover)",
    );
  });
});

describe("Replay trail-head key", () => {
  it("starts folded under a Trail heads summary, and opens and folds from it", async () => {
    const trailHeadKey = mount(createTrailHeadKey());
    const summary = page.getByText("Trail heads", { exact: true });
    await expect.element(summary).toBeVisible();
    const firstKeyRow = page.getByText("Moving", { exact: true });
    await expect.element(firstKeyRow).not.toBeVisible();
    await userEvent.click(summary);
    expect(trailHeadKey.open).toBe(true);
    await expect.element(firstKeyRow).toBeVisible();
    await expect
      .element(page.getByText("Round heads are players and square heads are bots."))
      .toBeVisible();
    trailHeadKey.querySelector("summary")?.focus();
    await userEvent.keyboard("{Enter}"); // folds again from the keyboard
    expect(trailHeadKey.open).toBe(false);
  });
});
