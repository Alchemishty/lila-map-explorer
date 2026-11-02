import { afterEach, describe, expect, it } from "vitest";
import { createMarkerSwatch } from "../render/markerSwatch";
import { createMarkerSwitches, type MarkerSwitches } from "./markerSwitches";
import { playerMarkerKeys } from "./markerVisibility";
import { fixtureEventConfig } from "./overviewTestFixtures";

// Runs in headless Chromium: the legend rows as switches.

const mountedElements: HTMLElement[] = [];
afterEach(() => {
  for (const element of mountedElements.splice(0)) {
    element.remove();
  }
});

function mountSwitches(): { switches: MarkerSwitches; changes: string[][] } {
  const changes: string[][] = [];
  const switches = createMarkerSwitches(fixtureEventConfig, (markerKeys) =>
    changes.push([...markerKeys].sort()),
  );
  document.body.appendChild(switches.element);
  mountedElements.push(switches.element);
  return { switches, changes };
}

function checkboxNamed(root: HTMLElement, accessibleName: string): HTMLInputElement {
  const checkbox = [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
    (candidate) => candidate.labels?.[0]?.textContent === accessibleName,
  );
  if (checkbox === undefined) {
    throw new Error(`No checkbox is labelled "${accessibleName}"`);
  }
  return checkbox;
}

function buttonNamed(root: HTMLElement, accessibleName: string): HTMLButtonElement {
  const button = [...root.querySelectorAll("button")].find(
    (candidate) =>
      (candidate.getAttribute("aria-label") ?? candidate.textContent) === accessibleName,
  );
  if (button === undefined) {
    throw new Error(`No button is named "${accessibleName}"`);
  }
  return button;
}

const allPlayerKeys = playerMarkerKeys(fixtureEventConfig);
const playerLabels = [
  "Player killed a player",
  "Player killed a bot",
  "Player killed by a player",
  "Player killed by a bot",
  "Player died to storm",
  "Player looted",
];
const botLabels = ["Bot made a kill (victim not recorded)", "Bot died (killer not recorded)"];

describe("createMarkerSwitches", () => {
  it("shows one labelled switch and one Only button per legend marker, in config order", () => {
    const { switches } = mountSwitches();
    switches.showState(new Set(allPlayerKeys), "all", "Bot events (2 of 3 matches have bot data)");
    const rowLabels = [...switches.element.querySelectorAll(".legend-entry label")].map(
      (label) => label.textContent,
    );
    expect(rowLabels).toEqual([...playerLabels, ...botLabels]);
    for (const label of [...playerLabels, ...botLabels]) {
      expect(buttonNamed(switches.element, `Show only ${label}`).textContent).toBe("Only");
    }
  });

  it("sets each switch from the visible set and heads the bot rows with the given text", () => {
    const { switches } = mountSwitches();
    switches.showState(
      new Set(["loot", "bot_death"]),
      "all",
      "Bot events (2 of 3 matches have bot data)",
    );
    expect(checkboxNamed(switches.element, "Player looted").checked).toBe(true);
    expect(checkboxNamed(switches.element, "Player died to storm").checked).toBe(false);
    expect(checkboxNamed(switches.element, "Bot died (killer not recorded)").checked).toBe(true);
    const botHeading = switches.element.querySelector(".marker-switch-bot-heading");
    expect(botHeading?.textContent).toBe("Bot events (2 of 3 matches have bot data)");
  });

  it("puts Show all and Hide all before the player rows", () => {
    const { switches } = mountSwitches();
    switches.showState(new Set(), "all", "Bot events");
    const showAllButton = buttonNamed(switches.element, "Show all");
    const firstRow = switches.element.querySelector(".legend-entry");
    if (firstRow === null) {
      throw new Error("No legend rows were drawn");
    }
    expect(
      showAllButton.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(buttonNamed(switches.element, "Hide all")).toBeDefined();
  });

  it("reports the new set for a switch, Show all, Hide all and Only", () => {
    const { switches, changes } = mountSwitches();
    switches.showState(new Set(["loot", "bot_kill"]), "all", "Bot events");
    checkboxNamed(switches.element, "Player looted").click();
    buttonNamed(switches.element, "Show all").click();
    buttonNamed(switches.element, "Hide all").click();
    buttonNamed(switches.element, "Show only Player died to storm").click();
    expect(changes).toEqual([
      ["bot_kill"],
      [...allPlayerKeys, "bot_kill"].sort(),
      ["bot_kill"],
      ["storm_death"],
    ]);
  });

  it("leaves out the bot rows and their heading for the player-only legend", () => {
    const { switches } = mountSwitches();
    switches.showState(new Set(allPlayerKeys), "player", "Bot events");
    const visibleRowLabels = [...switches.element.querySelectorAll<HTMLElement>(".legend-entry")]
      .filter((row) => row.offsetParent !== null)
      .map((row) => row.querySelector("label")?.textContent);
    expect(visibleRowLabels).toEqual(playerLabels);
    const botHeading = switches.element.querySelector<HTMLElement>(".marker-switch-bot-heading");
    expect(botHeading?.offsetParent).toBeNull();
  });

  it("draws a legend swatch in the marker's own fill color", () => {
    const lootStyle = fixtureEventConfig.markers.loot;
    if (lootStyle === undefined) {
      throw new Error("The fixture event config has no loot marker");
    }
    const swatch = createMarkerSwatch(lootStyle);
    const context = swatch.getContext("2d");
    if (context === null) {
      throw new Error("The swatch has no 2D context");
    }
    const [red, green, blue] = context.getImageData(swatch.width / 2, swatch.height / 2, 1, 1).data;
    expect([red, green, blue]).toEqual([0xfa, 0xcc, 0x15]);
  });
});
