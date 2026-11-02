import type { EventConfig } from "../domain/types";
import { createMarkerSwatch } from "../render/markerSwatch";
import { legendEntries, type LegendEntry, type LegendInclude } from "./legend";
import {
  botOnlyMarkerKeys,
  onlyMarker,
  withAllPlayerMarkers,
  withMarkerVisibility,
} from "./markerVisibility";

// The legend as switches: one row per marker type with its swatch,
// a checkbox and an "Only" button, "Show all" / "Hide all" for the player types, and the bot-event
// rows under their own heading. Shared by the Overview and Replay panels.

export interface MarkerSwitches {
  readonly element: HTMLElement;
  /**
   * Sets every switch from the visible set. include "player" hides the bot rows and heading
   * (Replay's "Hide bot tracks and bot events"); botHeadingText heads the bot rows.
   */
  showState(markerKeys: ReadonlySet<string>, include: LegendInclude, botHeadingText: string): void;
}

export const markerPositionExplanationText =
  "Kill markers show the killer’s position. Death markers show where the actor died.";

function createActionButton(text: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "marker-switch-action";
  button.textContent = text;
  button.addEventListener("click", onClick);
  return button;
}

export function createMarkerSwitches(
  eventConfig: EventConfig,
  onChange: (markerKeys: ReadonlySet<string>) => void,
): MarkerSwitches {
  let shownMarkerKeys: ReadonlySet<string> | null = null;
  function requireShownMarkerKeys(): ReadonlySet<string> {
    if (shownMarkerKeys === null) {
      throw new Error("The marker switches were used before they were shown any state");
    }
    return shownMarkerKeys;
  }

  const switchesElement = document.createElement("div");
  switchesElement.className = "marker-switches";
  const actionsElement = document.createElement("div");
  actionsElement.className = "marker-switch-actions";
  actionsElement.append(
    createActionButton("Show all", () =>
      onChange(withAllPlayerMarkers(requireShownMarkerKeys(), true, eventConfig)),
    ),
    createActionButton("Hide all", () =>
      onChange(withAllPlayerMarkers(requireShownMarkerKeys(), false, eventConfig)),
    ),
  );

  const checkboxesByMarkerKey = new Map<string, HTMLInputElement>();
  function createRow(entry: LegendEntry): HTMLLIElement {
    const rowElement = document.createElement("li");
    rowElement.className = "legend-entry";
    rowElement.dataset.markerKey = entry.markerKey;
    const labelElement = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.addEventListener("change", () =>
      onChange(
        withMarkerVisibility(
          requireShownMarkerKeys(),
          entry.markerKey,
          checkbox.checked,
          eventConfig,
        ),
      ),
    );
    const swatch = createMarkerSwatch(entry.style);
    swatch.setAttribute("aria-hidden", "true");
    const textElement = document.createElement("span");
    textElement.textContent = entry.style.label;
    labelElement.append(checkbox, swatch, textElement);
    const onlyButton = createActionButton("Only", () =>
      onChange(onlyMarker(entry.markerKey, eventConfig)),
    );
    onlyButton.className = "marker-only-button";
    onlyButton.setAttribute("aria-label", `Show only ${entry.style.label}`);
    rowElement.append(labelElement, onlyButton);
    checkboxesByMarkerKey.set(entry.markerKey, checkbox);
    return rowElement;
  }

  const botKeys = new Set(botOnlyMarkerKeys(eventConfig));
  const allEntries = legendEntries(eventConfig, "all");
  const playerListElement = document.createElement("ul");
  playerListElement.className = "legend";
  playerListElement.append(
    ...allEntries.filter((entry) => !botKeys.has(entry.markerKey)).map(createRow),
  );
  const botHeadingElement = document.createElement("h3");
  botHeadingElement.className = "marker-switch-bot-heading";
  const botListElement = document.createElement("ul");
  botListElement.className = "legend";
  botListElement.append(
    ...allEntries.filter((entry) => botKeys.has(entry.markerKey)).map(createRow),
  );
  const explanationElement = document.createElement("p");
  explanationElement.className = "marker-position-explanation";
  explanationElement.textContent = markerPositionExplanationText;
  switchesElement.append(
    actionsElement,
    playerListElement,
    botHeadingElement,
    botListElement,
    explanationElement,
  );

  return {
    element: switchesElement,
    showState: (markerKeys, include, botHeadingText) => {
      shownMarkerKeys = markerKeys;
      for (const [markerKey, checkbox] of checkboxesByMarkerKey) {
        checkbox.checked = markerKeys.has(markerKey);
      }
      botHeadingElement.textContent = botHeadingText;
      const areBotRowsShown = include === "all";
      botHeadingElement.hidden = !areBotRowsShown;
      botListElement.hidden = !areBotRowsShown;
    },
  };
}
