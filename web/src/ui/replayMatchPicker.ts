import { groupMatchesByStartDay } from "../domain/filters";
import type { MatchSummary } from "../domain/types";
import { formatDayLabel, formatMatchLabel, formatMatchRowLabel } from "./matchPicker";

// Replay's match picker: a native select, so phones open their own picker. Its options sit in one
// <optgroup> per UTC start day and drop the repeated day. A native select shows only the chosen
// option's text, so the field draws the chosen match's full label (day included) under a
// see-through select: on a phone the label wraps onto a second line instead of being cut off.

export const noMatchesMessage = "No matches for these filters";

export interface ReplayMatchPicker {
  /** The labelled field, for the top bar. */
  readonly fieldElement: HTMLLabelElement;
  readonly select: HTMLSelectElement;
  /** Shows exactly these matches (time order, as selectMatches gives them) and the chosen one. */
  showMatches(selectedMatches: readonly MatchSummary[], chosenMatchId: string | null): void;
}

let nextChosenLabelNumber = 1;

function buildOptionGroups(selectedMatches: readonly MatchSummary[]): HTMLOptGroupElement[] {
  return groupMatchesByStartDay(selectedMatches).map((dayGroup) => {
    const optionGroup = document.createElement("optgroup");
    optionGroup.label = formatDayLabel(dayGroup.dayUtc);
    optionGroup.append(
      ...dayGroup.matches.map((match) => new Option(formatMatchRowLabel(match), match.matchId)),
    );
    return optionGroup;
  });
}

function hasSameOptions(select: HTMLSelectElement, nextChildren: readonly HTMLElement[]): boolean {
  const existingGroupLabels = [...select.querySelectorAll("optgroup")].map((group) => group.label);
  const nextGroupLabels = nextChildren
    .filter((child) => child instanceof HTMLOptGroupElement)
    .map((group) => group.label);
  const nextOptionValues = nextChildren.flatMap((child) =>
    child instanceof HTMLOptionElement
      ? [child.value]
      : [...child.querySelectorAll("option")].map((option) => option.value),
  );
  return (
    select.options.length === nextOptionValues.length &&
    nextOptionValues.every((value, i) => select.options[i]?.value === value) &&
    existingGroupLabels.length === nextGroupLabels.length &&
    existingGroupLabels.every((label, i) => label === nextGroupLabels[i])
  );
}

export function createReplayMatchPicker(onChoose: (matchId: string) => void): ReplayMatchPicker {
  const fieldElement = document.createElement("label");
  fieldElement.className = "top-bar-field replay-match-field";
  const labelTextElement = document.createElement("span");
  labelTextElement.className = "field-label-text";
  labelTextElement.textContent = "Match";

  const controlElement = document.createElement("span");
  controlElement.className = "replay-match-control";
  const chosenLabelElement = document.createElement("span");
  chosenLabelElement.className = "replay-match-chosen";
  chosenLabelElement.id = `replay-match-chosen-${nextChosenLabelNumber}`;
  nextChosenLabelNumber += 1;
  // The select already speaks the chosen row; the full label (with its day) is its description.
  chosenLabelElement.setAttribute("aria-hidden", "true");
  const select = document.createElement("select");
  select.setAttribute("aria-describedby", chosenLabelElement.id);
  controlElement.append(chosenLabelElement, select);
  fieldElement.append(labelTextElement, controlElement);

  select.addEventListener("change", () => onChoose(select.value));

  return {
    fieldElement,
    select,
    showMatches: (selectedMatches, chosenMatchId) => {
      select.disabled = selectedMatches.length === 0;
      const nextChildren =
        selectedMatches.length === 0
          ? [new Option(noMatchesMessage, "")]
          : buildOptionGroups(selectedMatches);
      if (!hasSameOptions(select, nextChildren)) {
        select.replaceChildren(...nextChildren);
      }
      select.value = chosenMatchId === null ? "" : chosenMatchId;
      const chosenMatch = selectedMatches.find((match) => match.matchId === chosenMatchId);
      if (chosenMatchId !== null && chosenMatch === undefined) {
        throw new Error(`The Replay match "${chosenMatchId}" is not one of the selected matches`);
      }
      if (chosenMatch !== undefined) {
        chosenLabelElement.textContent = formatMatchLabel(chosenMatch);
      } else {
        // Valid paths: no selected match (the picker says so), or Overview before any match is
        // replayed, where the field is hidden and nothing is chosen.
        chosenLabelElement.textContent = selectedMatches.length === 0 ? noMatchesMessage : "";
      }
    },
  };
}
