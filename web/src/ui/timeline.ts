import { seekPlayback, type PlaybackSpeed, type PlaybackState } from "../domain/playback";
import type { TimelineTick } from "../domain/playback";
import type { MarkerStyle } from "../domain/types";
import { attachTickTooltip, createTickTooltip } from "./tickTooltip";

// Replay's timeline: play/pause, speeds 1×, 4× and 16×, a scrubber, colored event ticks
// that seek to their moment, and "elapsed / total". It reports a new playback clock through
// onPlaybackChange; the panel applies it through the app state and calls showState again.

export interface TimelineOptions {
  /** The style of each marker key, for the tick colors and labels. */
  readonly requireMarkerStyle: (markerKey: string) => MarkerStyle;
  readonly onPlaybackChange: (playback: PlaybackState) => void;
}

export interface Timeline {
  readonly element: HTMLElement;
  /** Shows the clock; null playback (no match) disables every control. */
  showState(playback: PlaybackState | null, ticks: readonly TimelineTick[]): void;
}

export const playButtonLabel = "Play";
export const pauseButtonLabel = "Pause";
export const playbackSpeeds: readonly PlaybackSpeed[] = [1, 4, 16];
const secondsPerMinute = 60;

/** Seconds into the match as "m:ss", rounded down to the whole second. */
export function formatElapsedClock(elapsedSeconds: number): string {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    throw new Error(`Cannot show ${elapsedSeconds} s as m:ss: it must be a finite time, 0 or more`);
  }
  const wholeSeconds = Math.floor(elapsedSeconds);
  const minutes = Math.floor(wholeSeconds / secondsPerMinute);
  const remainderSeconds = wholeSeconds % secondsPerMinute;
  return `${minutes}:${String(remainderSeconds).padStart(2, "0")}`;
}

/** "m:ss / m:ss": elapsed, then the match length. */
export function formatTimelineClock(elapsedSeconds: number, durationSeconds: number): string {
  return `${formatElapsedClock(elapsedSeconds)} / ${formatElapsedClock(durationSeconds)}`;
}

export function createTimeline(options: TimelineOptions): Timeline {
  const { requireMarkerStyle, onPlaybackChange } = options;
  let shownPlayback: PlaybackState | null = null;
  let shownTicks: readonly TimelineTick[] | null = null;
  function requireShownPlayback(): PlaybackState {
    if (shownPlayback === null) {
      throw new Error("A timeline control was used while no match is replayed");
    }
    return shownPlayback;
  }

  const timelineElement = document.createElement("section");
  timelineElement.className = "timeline";
  timelineElement.setAttribute("aria-label", "Timeline");
  timelineElement.hidden = true; // shown by the Replay panel; never takes space before then

  const controlsElement = document.createElement("div");
  controlsElement.className = "timeline-controls";
  const playButton = document.createElement("button");
  playButton.type = "button";
  playButton.className = "timeline-play-button";
  playButton.addEventListener("click", () => {
    const playback = requireShownPlayback();
    // Play at the end starts the match again from the beginning.
    const isAtEnd = playback.elapsedSeconds >= playback.durationSeconds;
    const startingPlayback = !playback.isPlaying && isAtEnd ? seekPlayback(playback, 0) : playback;
    onPlaybackChange({ ...startingPlayback, isPlaying: !playback.isPlaying });
  });

  const speedGroup = document.createElement("div");
  speedGroup.className = "timeline-speeds";
  speedGroup.setAttribute("role", "group");
  speedGroup.setAttribute("aria-label", "Playback speed");
  const speedButtonsBySpeed = new Map<PlaybackSpeed, HTMLButtonElement>();
  for (const speed of playbackSpeeds) {
    const speedButton = document.createElement("button");
    speedButton.type = "button";
    speedButton.textContent = `${speed}×`;
    speedButton.addEventListener("click", () =>
      onPlaybackChange({ ...requireShownPlayback(), speed }),
    );
    speedButtonsBySpeed.set(speed, speedButton);
    speedGroup.append(speedButton);
  }

  const clockElement = document.createElement("span");
  clockElement.className = "timeline-clock";
  controlsElement.append(playButton, speedGroup, clockElement);

  const trackElement = document.createElement("div");
  trackElement.className = "timeline-track";
  const ticksElement = document.createElement("div");
  ticksElement.className = "timeline-ticks";
  const scrubber = document.createElement("input");
  scrubber.type = "range";
  scrubber.className = "timeline-scrubber";
  scrubber.min = "0";
  scrubber.step = "any";
  scrubber.setAttribute("aria-label", "Time into match");
  scrubber.addEventListener("input", () =>
    onPlaybackChange(seekPlayback(requireShownPlayback(), Number(scrubber.value))),
  );
  trackElement.append(ticksElement, scrubber);
  timelineElement.append(controlsElement, trackElement);

  function showTicks(ticks: readonly TimelineTick[]): void {
    ticksElement.replaceChildren(
      ...ticks.map((tick) => {
        const style = requireMarkerStyle(tick.markerKey);
        const tickButton = document.createElement("button");
        tickButton.type = "button";
        tickButton.className = "timeline-tick";
        tickButton.dataset.markerKey = tick.markerKey;
        tickButton.dataset.outline = style.outline;
        tickButton.style.left = `${tick.fraction * 100}%`;
        // The button is the larger hit target; the mark drawn inside it keeps its colour.
        tickButton.style.setProperty("--tick-fill", style.fill);
        const elapsedClock = formatElapsedClock(tick.elapsedSeconds);
        tickButton.setAttribute("aria-label", `${style.label} at ${elapsedClock}`);
        const tooltipElement = createTickTooltip(style.label, elapsedClock);
        tickButton.append(tooltipElement);
        attachTickTooltip(tickButton, tooltipElement, timelineElement);
        tickButton.addEventListener("click", () =>
          onPlaybackChange(seekPlayback(requireShownPlayback(), tick.elapsedSeconds)),
        );
        return tickButton;
      }),
    );
  }

  return {
    element: timelineElement,
    showState: (playback, ticks) => {
      shownPlayback = playback;
      const hasMatch = playback !== null;
      playButton.disabled = !hasMatch;
      scrubber.disabled = !hasMatch;
      for (const [speed, speedButton] of speedButtonsBySpeed) {
        speedButton.disabled = !hasMatch;
        speedButton.setAttribute("aria-pressed", String(hasMatch && playback.speed === speed));
      }
      const isPlaying = hasMatch && playback.isPlaying;
      playButton.setAttribute("aria-label", isPlaying ? pauseButtonLabel : playButtonLabel);
      playButton.textContent = isPlaying ? "❚❚" : "▶";
      if (ticks !== shownTicks) {
        showTicks(ticks);
        shownTicks = ticks;
      }
      if (playback === null) {
        clockElement.textContent = formatTimelineClock(0, 0);
        scrubber.max = "0";
        scrubber.value = "0";
        return;
      }
      clockElement.textContent = formatTimelineClock(
        playback.elapsedSeconds,
        playback.durationSeconds,
      );
      scrubber.max = String(playback.durationSeconds);
      scrubber.value = String(playback.elapsedSeconds);
    },
  };
}
