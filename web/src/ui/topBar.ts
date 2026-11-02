import { availableDays, groupMatchesByStartDay, selectMatches } from "../domain/filters";
import type { MapConfig, MatchSummary } from "../domain/types";
import { formatDayLabel, formatMatchRowLabel, toggleMatchInSubset } from "./matchPicker";
import { createReplayMatchPicker } from "./replayMatchPicker";
import type { AppMode, AppState } from "./stateTransitions";
import {
  closeDropdownsLikeMenus,
  createDropdown,
  syncCheckboxList,
  syncGroupedCheckboxList,
} from "./topBarLists";

export { noMatchesMessage } from "./replayMatchPicker";

// The top bar: the map first (the designer's main subject), the Overview/Replay switch, the UTC
// days, the match subset grouped by UTC start day and, in Replay, the match being replayed. It
// only reports changes; the app applies them through transitionAppState and calls showState with
// the result.

export interface TopBarOptions {
  readonly mapConfigs: readonly MapConfig[];
  readonly matches: readonly MatchSummary[];
  readonly onChange: (patch: Partial<AppState>) => void;
}

export interface TopBar {
  readonly element: HTMLElement;
  showState(state: AppState): void;
}

function createLabelledSelect(
  labelText: string,
  className: string,
): { selectLabel: HTMLLabelElement; select: HTMLSelectElement } {
  const selectLabel = document.createElement("label");
  selectLabel.className = `top-bar-field ${className}`;
  const labelTextElement = document.createElement("span");
  labelTextElement.className = "field-label-text";
  labelTextElement.textContent = labelText;
  const select = document.createElement("select");
  selectLabel.append(labelTextElement, select);
  return { selectLabel, select };
}

export function createTopBar(options: TopBarOptions): TopBar {
  const { mapConfigs, matches, onChange } = options;
  let latestState: AppState | null = null;
  function requireLatestState(): AppState {
    if (latestState === null) {
      throw new Error("The top bar was used before it was shown any state");
    }
    return latestState;
  }

  const barElement = document.createElement("header");
  barElement.className = "top-bar";
  const titleElement = document.createElement("span");
  titleElement.className = "top-bar-title";
  titleElement.textContent = "LILA Map Explorer";

  const modeGroup = document.createElement("div");
  modeGroup.className = "mode-switch";
  modeGroup.setAttribute("role", "group");
  modeGroup.setAttribute("aria-label", "Mode");
  const modeButtonsByMode = new Map<AppMode, HTMLButtonElement>();
  for (const [mode, labelText] of [
    ["overview", "Overview"],
    ["replay", "Replay"],
  ] as const) {
    const modeButton = document.createElement("button");
    modeButton.type = "button";
    modeButton.textContent = labelText;
    modeButton.addEventListener("click", () => onChange({ appMode: mode }));
    modeButtonsByMode.set(mode, modeButton);
    modeGroup.append(modeButton);
  }

  const filterGroup = document.createElement("div");
  filterGroup.className = "top-bar-filters";

  const { selectLabel: mapLabel, select: mapSelect } = createLabelledSelect("Map", "map-field");
  mapSelect.append(...mapConfigs.map((map) => new Option(map.mapId, map.mapId)));
  mapSelect.addEventListener("change", () => {
    onChange({ filter: { ...requireLatestState().filter, mapId: mapSelect.value } });
  });

  const days = createDropdown("day-dropdown");
  days.listElement.setAttribute("aria-label", "UTC days");
  days.listElement.addEventListener("change", (event) => {
    const dayInput = event.target;
    if (!(dayInput instanceof HTMLInputElement)) {
      throw new Error("A day change came from something that is not a checkbox");
    }
    const filter = requireLatestState().filter;
    const dayUtcSet = new Set(filter.dayUtcSet);
    if (dayInput.checked) {
      dayUtcSet.add(dayInput.value);
    } else {
      dayUtcSet.delete(dayInput.value);
    }
    onChange({ filter: { ...filter, dayUtcSet } });
  });

  const matchSubset = createDropdown("match-dropdown");
  const allMatchesLabel = document.createElement("label");
  allMatchesLabel.className = "checkbox-row all-matches-row";
  const allMatchesInput = document.createElement("input");
  allMatchesInput.type = "checkbox";
  allMatchesLabel.append(allMatchesInput, document.createTextNode("All matches"));
  allMatchesInput.addEventListener("change", () => {
    // Checking "All matches" clears the subset; unchecking it alone selects nothing new, so the
    // next showState checks it again.
    onChange({ filter: { ...requireLatestState().filter, matchIdSet: null } });
  });
  const matchList = document.createElement("div");
  matchList.setAttribute("aria-label", "Matches");
  matchSubset.listElement.append(allMatchesLabel, matchList);
  matchList.addEventListener("change", (event) => {
    const matchInput = event.target;
    if (!(matchInput instanceof HTMLInputElement)) {
      throw new Error("A match change came from something that is not a checkbox");
    }
    const filter = requireLatestState().filter;
    const availableMatchIds = selectMatches(matches, { ...filter, matchIdSet: null }).map(
      (match) => match.matchId,
    );
    const matchIdSet = toggleMatchInSubset(
      filter.matchIdSet,
      availableMatchIds,
      matchInput.value,
      matchInput.checked,
    );
    onChange({ filter: { ...filter, matchIdSet } });
  });

  const replayMatchPicker = createReplayMatchPicker((matchId) => {
    onChange({ replay: { ...requireLatestState().replay, matchId } });
  });

  closeDropdownsLikeMenus([days.dropdown, matchSubset.dropdown]);
  filterGroup.append(days.dropdown, matchSubset.dropdown, replayMatchPicker.fieldElement);
  barElement.append(titleElement, mapLabel, modeGroup, filterGroup);

  return {
    element: barElement,
    showState: (state) => {
      latestState = state;
      const { filter } = state;
      for (const [mode, modeButton] of modeButtonsByMode) {
        modeButton.setAttribute("aria-pressed", String(state.appMode === mode));
      }
      mapSelect.value = filter.mapId;

      const dayUtcList = availableDays(matches, filter.mapId);
      days.summary.textContent =
        dayUtcList.length === 0
          ? "Dates (UTC): none"
          : `Dates (UTC): ${filter.dayUtcSet.size} of ${dayUtcList.length} days`;
      syncCheckboxList(
        days.listElement,
        dayUtcList.map((dayUtc) => ({
          value: dayUtc,
          labelText: formatDayLabel(dayUtc),
          isChecked: filter.dayUtcSet.has(dayUtc),
        })),
      );

      const selectedMatches = selectMatches(matches, filter);
      matchSubset.summary.textContent = `${selectedMatches.length} matches`;
      allMatchesInput.checked = filter.matchIdSet === null;
      syncGroupedCheckboxList(
        matchList,
        groupMatchesByStartDay(selectMatches(matches, { ...filter, matchIdSet: null })).map(
          (dayGroup) => ({
            headingText: formatDayLabel(dayGroup.dayUtc),
            items: dayGroup.matches.map((match) => ({
              value: match.matchId,
              labelText: formatMatchRowLabel(match),
              isChecked: filter.matchIdSet === null || filter.matchIdSet.has(match.matchId),
            })),
          }),
        ),
      );

      replayMatchPicker.fieldElement.hidden = state.appMode !== "replay";
      replayMatchPicker.showMatches(selectedMatches, state.replay.matchId);
    },
  };
}
