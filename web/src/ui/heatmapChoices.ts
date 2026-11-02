import { darkestColorMinimumEventCount } from "../domain/heatmapColorTop";
import type { HeatmapKind } from "../domain/heatmap";

export const heatmapChoices: readonly {
  readonly heatmapKind: HeatmapKind | null;
  readonly label: string;
  readonly description: string;
}[] = [
  { heatmapKind: null, label: "Off", description: "" },
  {
    heatmapKind: "kills",
    label: "Kill zones",
    description: "Where players stood when they made a kill",
  },
  {
    heatmapKind: "combatDeaths",
    label: "Combat death zones",
    description: "Where players were killed by a player or a bot",
  },
  {
    heatmapKind: "stormDeaths",
    label: "Storm death zones",
    description: "Where players died to the storm",
  },
  {
    heatmapKind: "traffic",
    label: "Traffic",
    description: "Where players spent the most time",
  },
];

// The colour scale's title carries the sample size, so a designer knows how much to trust a
// heatmap whose darkest red means "busiest zone". With few events the darkest red is kept for a
// minimum stack of events instead (domain/heatmapColorTop.ts), and a note under the scale says so.

const scaleTitleNounsByKind: Readonly<
  Record<Exclude<HeatmapKind, "traffic">, { readonly singular: string; readonly plural: string }>
> = {
  kills: { singular: "kill", plural: "kills" },
  combatDeaths: { singular: "combat death", plural: "combat deaths" },
  stormDeaths: { singular: "storm death", plural: "storm deaths" },
};

const wholeNumberFormat = new Intl.NumberFormat("en-US");

function requireChoiceLabel(heatmapKind: HeatmapKind): string {
  const choice = heatmapChoices.find((candidate) => candidate.heatmapKind === heatmapKind);
  if (choice === undefined) {
    throw new Error(`Heatmap "${heatmapKind}" has no choice in heatmapChoices`);
  }
  return choice.label;
}

/** Play time, rounded down: "{h} h {m} min" from one hour, "{m} min {s} s" below it. */
export function formatTrafficDuration(totalSeconds: number): string {
  if (!(Number.isFinite(totalSeconds) && totalSeconds >= 0)) {
    throw new Error(`A traffic duration needs zero or more seconds, got ${totalSeconds}`);
  }
  const wholeSeconds = Math.floor(totalSeconds);
  const wholeHours = Math.floor(wholeSeconds / 3600);
  const minutesPastHour = Math.floor((wholeSeconds % 3600) / 60);
  if (wholeHours >= 1) {
    return `${wholeNumberFormat.format(wholeHours)} h ${minutesPastHour} min`;
  }
  return `${minutesPastHour} min ${wholeSeconds % 60} s`;
}

/** "Kill zones · 1,671 kills", or for traffic "Traffic · 412 h 5 min of play". */
export function formatHeatmapScaleTitle(heatmapKind: HeatmapKind, total: number): string {
  const label = requireChoiceLabel(heatmapKind);
  if (heatmapKind === "traffic") {
    return `${label} · ${formatTrafficDuration(total)} of play`;
  }
  if (!(Number.isInteger(total) && total >= 0)) {
    throw new Error(`A ${label} count must be a whole number of zero or more, got ${total}`);
  }
  const nouns = scaleTitleNounsByKind[heatmapKind];
  return `${label} · ${wholeNumberFormat.format(total)} ${total === 1 ? nouns.singular : nouns.plural}`;
}

export interface HeatmapScale {
  readonly element: HTMLElement;
  /**
   * Shows the scale for a heatmap and its exact total; hides it while the heatmap is off. With
   * isColorTopRaised, a note says so few events are shown that none reaches the darkest colour.
   */
  showState(heatmapKind: HeatmapKind | null, total: number | null, isColorTopRaised: boolean): void;
}

/** Shown under the scale when the colour top is raised to its minimum (domain/heatmapColorTop.ts). */
export const raisedColorTopNoteText = `Few events here, so dark red is kept for ${darkestColorMinimumEventCount} or more in one spot.`;

/**
 * The colour scale: title with the sample size, the ramp as a bar with its busiest part outlined
 * the way the map outlines the busiest zones (no caption: the outlined end sits over "busiest
 * zone", user decision 2026-11-02), and "fewer" / "busiest zone".
 * busiestZoneStartPercent is where that part starts, as a percent of the bar's width.
 */
export function createHeatmapScale(
  rampCssGradient: string,
  busiestZoneStartPercent: number,
): HeatmapScale {
  if (!(busiestZoneStartPercent >= 0 && busiestZoneStartPercent < 100)) {
    throw new Error(
      `The busiest zones must start inside the colour scale, got ${busiestZoneStartPercent}%`,
    );
  }
  const scaleElement = document.createElement("div");
  scaleElement.className = "heatmap-scale";
  const titleElement = document.createElement("div");
  titleElement.className = "heatmap-scale-title";
  const barElement = document.createElement("div");
  barElement.className = "heatmap-scale-bar";
  barElement.setAttribute("aria-hidden", "true");
  barElement.style.backgroundImage = rampCssGradient;
  const busiestOutlineElement = document.createElement("div");
  busiestOutlineElement.className = "heatmap-scale-busiest-outline";
  busiestOutlineElement.style.left = `${busiestZoneStartPercent}%`;
  barElement.append(busiestOutlineElement);
  const endsElement = document.createElement("div");
  endsElement.className = "heatmap-scale-ends";
  const fewerElement = document.createElement("span");
  fewerElement.className = "heatmap-scale-fewer";
  fewerElement.textContent = "fewer";
  const busiestElement = document.createElement("span");
  busiestElement.className = "heatmap-scale-busiest";
  busiestElement.textContent = "busiest zone";
  endsElement.append(fewerElement, busiestElement);
  const raisedTopNoteElement = document.createElement("div");
  raisedTopNoteElement.className = "heatmap-scale-note";
  raisedTopNoteElement.textContent = raisedColorTopNoteText;
  raisedTopNoteElement.hidden = true;
  scaleElement.append(titleElement, barElement, endsElement, raisedTopNoteElement);
  scaleElement.hidden = true;
  return {
    element: scaleElement,
    showState: (heatmapKind, total, isColorTopRaised) => {
      if (heatmapKind === null) {
        scaleElement.hidden = true; // valid path: no heatmap, no scale
        return;
      }
      if (total === null) {
        throw new Error(`The "${heatmapKind}" heatmap is on but has no total for its colour scale`);
      }
      titleElement.textContent = formatHeatmapScaleTitle(heatmapKind, total);
      raisedTopNoteElement.hidden = !isColorTopRaised;
      scaleElement.hidden = false;
    },
  };
}
