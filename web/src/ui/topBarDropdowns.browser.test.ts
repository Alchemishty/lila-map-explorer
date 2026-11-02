import { afterEach, describe, expect, it } from "vitest";
import { fixtureManifest } from "./overviewTestFixtures";
import { createInitialAppState } from "./stateTransitions";
import { createTopBar, type TopBar } from "./topBar";

// Runs in headless Chromium (vitest.workspace.ts "browser" project). The Dates and matches
// dropdowns close the way a designer expects (found on an Android emulator): a press
// outside the open one or Escape closes it, and only one is open at a time.

const mountedElements: HTMLElement[] = [];

afterEach(() => {
  for (const mountedElement of mountedElements.splice(0)) {
    mountedElement.remove();
  }
});

function mountTopBar(): TopBar {
  const topBar = createTopBar({
    mapConfigs: fixtureManifest.maps,
    matches: fixtureManifest.matches,
    onChange: () => undefined,
  });
  topBar.showState(createInitialAppState(fixtureManifest));
  document.body.appendChild(topBar.element);
  mountedElements.push(topBar.element);
  return topBar;
}

function requireDropdown(topBar: TopBar, className: string): HTMLDetailsElement {
  const dropdown = topBar.element.querySelector(`details.${className}`);
  if (!(dropdown instanceof HTMLDetailsElement)) {
    throw new Error(`The top bar has no <details> dropdown with class "${className}"`);
  }
  return dropdown;
}

function requireSummary(dropdown: HTMLDetailsElement): HTMLElement {
  const summary = dropdown.querySelector("summary");
  if (summary === null) {
    throw new Error(`The dropdown "${dropdown.className}" has no summary`);
  }
  return summary;
}

/** Opens a dropdown the way a press on its summary does, and waits for its toggle event. */
async function openDropdown(dropdown: HTMLDetailsElement): Promise<void> {
  const toggled = new Promise((resolve) =>
    dropdown.addEventListener("toggle", resolve, { once: true }),
  );
  requireSummary(dropdown).click();
  await toggled;
  expect(dropdown.open).toBe(true);
}

function pressOn(target: Element): void {
  target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
}

describe("top bar dropdowns", () => {
  it("close when the designer presses outside the open one", async () => {
    const topBar = mountTopBar();
    const outsideElement = document.createElement("div");
    document.body.appendChild(outsideElement);
    mountedElements.push(outsideElement);
    const dayDropdown = requireDropdown(topBar, "day-dropdown");
    await openDropdown(dayDropdown);

    pressOn(outsideElement);

    expect(dayDropdown.open).toBe(false);
  });

  it("stay open when the press is inside the open list, so its checkboxes can be ticked", async () => {
    const topBar = mountTopBar();
    const dayDropdown = requireDropdown(topBar, "day-dropdown");
    await openDropdown(dayDropdown);
    const firstDayCheckbox = dayDropdown.querySelector(".filter-dropdown-list input");
    if (firstDayCheckbox === null) {
      throw new Error("The Dates dropdown has no day checkbox");
    }

    pressOn(firstDayCheckbox);

    expect(dayDropdown.open).toBe(true);
  });

  it("close on Escape and give focus back to the dropdown's button", async () => {
    const topBar = mountTopBar();
    const matchDropdown = requireDropdown(topBar, "match-dropdown");
    await openDropdown(matchDropdown);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(matchDropdown.open).toBe(false);
    expect(document.activeElement).toBe(requireSummary(matchDropdown));
  });

  it("are open one at a time: opening the matches closes the Dates", async () => {
    const topBar = mountTopBar();
    const dayDropdown = requireDropdown(topBar, "day-dropdown");
    const matchDropdown = requireDropdown(topBar, "match-dropdown");
    await openDropdown(dayDropdown);

    await openDropdown(matchDropdown);

    expect(dayDropdown.open).toBe(false);
    expect(matchDropdown.open).toBe(true);
  });
});
