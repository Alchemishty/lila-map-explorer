import "./theme.css";
import "./layout.css";
import "./timeline.css";
import { page, userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it } from "vitest";
import type { PlaybackState, TimelineTick } from "../domain/playback";
import type { MarkerStyle } from "../domain/types";
import { createTimeline, type Timeline } from "./timeline";

// Runs in headless Chromium: Replay's timeline ticks are 24 × 24 px targets around their small
// marks, show their marker label and time into match on hover and on keyboard focus, and jump to
// their moment when pressed.

const markerStylesByKey: Readonly<Record<string, MarkerStyle>> = {
  loot: {
    label: "Player looted",
    shape: "diamond",
    fill: "#facc15",
    cross: "",
    outline: "solid",
  },
  bot_kill: {
    label: "Bot made a kill (victim not recorded)",
    shape: "square",
    fill: "#ef4444",
    cross: "#ffffff",
    outline: "dashed",
  },
};

function requireMarkerStyle(markerKey: string): MarkerStyle {
  const style = markerStylesByKey[markerKey];
  if (style === undefined) {
    throw new Error(`No test marker style "${markerKey}"`);
  }
  return style;
}

/** A 100 s match, paused at its start. */
const pausedPlayback: PlaybackState = {
  matchStartTimestampSeconds: 1_770_854_400,
  durationSeconds: 100,
  elapsedSeconds: 0,
  speed: 1,
  isPlaying: false,
};

/** Near the start, in the middle and near the end of the track. */
const ticks: readonly TimelineTick[] = [
  { fraction: 0.05, markerKey: "loot", elapsedSeconds: 5 },
  { fraction: 0.5, markerKey: "bot_kill", elapsedSeconds: 50 },
  { fraction: 0.95, markerKey: "loot", elapsedSeconds: 95 },
];

const mountedElements: HTMLElement[] = [];

afterEach(async () => {
  for (const element of mountedElements.splice(0)) {
    element.remove();
  }
  await page.viewport(1280, 800);
});

function mountTimeline(shownTicks: readonly TimelineTick[] = ticks): {
  timeline: Timeline;
  playbackChanges: PlaybackState[];
} {
  const playbackChanges: PlaybackState[] = [];
  const timeline = createTimeline({
    requireMarkerStyle,
    onPlaybackChange: (playback) => playbackChanges.push(playback),
  });
  timeline.element.hidden = false;
  timeline.element.style.marginTop = "120px"; // room above for the tooltips
  document.body.appendChild(timeline.element);
  mountedElements.push(timeline.element);
  timeline.showState(pausedPlayback, shownTicks);
  return { timeline, playbackChanges };
}

function tickButtons(timeline: Timeline): HTMLButtonElement[] {
  return [...timeline.element.querySelectorAll<HTMLButtonElement>(".timeline-tick")];
}

function requireTick(timeline: Timeline, index: number): HTMLButtonElement {
  const tickButton = tickButtons(timeline)[index];
  if (tickButton === undefined) {
    throw new Error(`The timeline has no tick ${index}`);
  }
  return tickButton;
}

function requireTooltip(tickButton: HTMLButtonElement): HTMLElement {
  const tooltipElement = tickButton.querySelector<HTMLElement>(".timeline-tick-tooltip");
  if (tooltipElement === null) {
    throw new Error("The tick has no tooltip");
  }
  return tooltipElement;
}

function isTooltipShown(tickButton: HTMLButtonElement): boolean {
  return getComputedStyle(requireTooltip(tickButton)).visibility === "visible";
}

describe("Timeline ticks", () => {
  it("are 24 × 24 px targets around an unchanged 6 × 14 px mark in the marker's colour", () => {
    const { timeline } = mountTimeline();
    const tickButton = requireTick(timeline, 0);
    const targetBox = tickButton.getBoundingClientRect();
    expect([targetBox.width, targetBox.height]).toEqual([24, 24]);
    const markStyle = getComputedStyle(tickButton, "::before");
    expect([markStyle.width, markStyle.height]).toEqual(["6px", "14px"]);
    expect(markStyle.backgroundColor).toBe("rgb(250, 204, 21)"); // #facc15
    expect(getComputedStyle(tickButton).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    // The target is centred on the tick's moment, as the mark was.
    const trackBox = timeline.element.querySelector(".timeline-ticks")?.getBoundingClientRect();
    if (trackBox === undefined) {
      throw new Error("The timeline has no tick track");
    }
    const middleTarget = requireTick(timeline, 1).getBoundingClientRect();
    expect(middleTarget.left + middleTarget.width / 2).toBeCloseTo(
      trackBox.left + trackBox.width / 2,
      1,
    );
  });

  it("keep the dashed outline for bot-performed events", () => {
    const { timeline } = mountTimeline();
    expect(getComputedStyle(requireTick(timeline, 1), "::before").borderTopStyle).toBe("dashed");
    expect(getComputedStyle(requireTick(timeline, 0), "::before").borderTopStyle).toBe("solid");
  });

  it("are named by marker label and time, with the tooltip hidden from screen readers", () => {
    const { timeline } = mountTimeline();
    expect(
      tickButtons(timeline).map((tickButton) => tickButton.getAttribute("aria-label")),
    ).toEqual([
      "Player looted at 0:05",
      "Bot made a kill (victim not recorded) at 0:50",
      "Player looted at 1:35",
    ]);
    const tickButton = requireTick(timeline, 1);
    expect(tickButton.hasAttribute("title")).toBe(false); // no second, native tooltip
    expect(requireTooltip(tickButton).getAttribute("aria-hidden")).toBe("true");
    expect(
      [...requireTooltip(tickButton).children].map((lineElement) => lineElement.textContent),
    ).toEqual(["Bot made a kill (victim not recorded)", "Time into match: 0:50"]);
  });

  it("show the tooltip on hover and on keyboard focus only", async () => {
    const { timeline } = mountTimeline();
    const tickButton = requireTick(timeline, 1);
    expect(isTooltipShown(tickButton)).toBe(false);
    await userEvent.hover(tickButton);
    expect(isTooltipShown(tickButton)).toBe(true);
    await userEvent.unhover(tickButton);
    expect(isTooltipShown(tickButton)).toBe(false);

    requireTick(timeline, 0).focus();
    await userEvent.keyboard("{Tab}"); // keyboard focus moves to the middle tick
    expect(document.activeElement).toBe(tickButton);
    expect(isTooltipShown(tickButton)).toBe(true);
    expect(isTooltipShown(requireTick(timeline, 0))).toBe(false);
  });

  it("phone: keep even the longest label's tooltip on screen wherever its tick is", async () => {
    await page.viewport(390, 844);
    // The longest marker label, at the track's ends, near them and in the middle.
    const fractions = [0, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 0.8, 0.9, 0.95, 1];
    const { timeline } = mountTimeline(
      fractions.map((fraction) => ({
        fraction,
        markerKey: "bot_kill",
        elapsedSeconds: fraction * 100,
      })),
    );
    const viewportWidth = document.documentElement.clientWidth;
    expect(viewportWidth).toBe(390);
    const alignments: (string | undefined)[] = [];
    for (const tickButton of tickButtons(timeline)) {
      await userEvent.hover(tickButton);
      const tooltipElement = requireTooltip(tickButton);
      expect(isTooltipShown(tickButton)).toBe(true);
      const tooltipBox = tooltipElement.getBoundingClientRect();
      expect(tooltipBox.left).toBeGreaterThanOrEqual(0);
      expect(tooltipBox.right).toBeLessThanOrEqual(viewportWidth);
      alignments.push(tooltipElement.dataset.align);
    }
    // Centred where it fits, pinned to the tick's edge near either end.
    expect(alignments[0]).toBe("start");
    expect(alignments[5]).toBe("centre");
    expect(alignments[10]).toBe("end");
  });

  it("hide the tooltip on Escape until focus leaves the tick", async () => {
    const { timeline } = mountTimeline();
    const tickButton = requireTick(timeline, 1);
    requireTick(timeline, 0).focus();
    await userEvent.keyboard("{Tab}");
    expect(isTooltipShown(tickButton)).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(tickButton); // focus stays put
    expect(isTooltipShown(tickButton)).toBe(false);
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}{Tab}"); // away and back
    expect(document.activeElement).toBe(tickButton);
    expect(isTooltipShown(tickButton)).toBe(true);
  });

  it("jump to their moment when pressed anywhere on the target, beside the mark too", async () => {
    const { timeline, playbackChanges } = mountTimeline();
    const tickButton = requireTick(timeline, 2);
    const targetBox = tickButton.getBoundingClientRect();
    // 3 px in from the target's corner: outside the 6 × 14 px mark, inside the 24 × 24 px target.
    expect(document.elementFromPoint(targetBox.left + 3, targetBox.top + 3)).toBe(tickButton);
    await userEvent.click(tickButton, { position: { x: 3, y: 3 } });
    expect(playbackChanges.map((playback) => playback.elapsedSeconds)).toEqual([95]);
    expect(playbackChanges[0]?.isPlaying).toBe(false);
  });
});
