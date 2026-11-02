// The tooltip of a Replay timeline tick: its marker label and time into match, shown on hover and
// on keyboard focus (timeline.css). Hidden from screen readers, which hear the tick's own name. Each
// time it shows it is placed by the room it actually has, so even the longest label stays inside
// the timeline on a phone. Escape hides it until the pointer or focus leaves the tick (WCAG 1.4.13).

export type TooltipAlignment = "start" | "centre" | "end";

/** Half the tick's 24 px target (timeline.css): a start- or end-aligned tooltip lines up with it. */
const tickTargetHalfWidthPixels = 12;

/**
 * Where a tooltip tooltipWidthPixels wide goes over a tick centred at tickCentreX (CSS px, client
 * space) so it stays between boundaryLeftX and boundaryRightX: centred on the tick when it fits,
 * otherwise lined up with the tick's left edge (running right) or right edge (running left).
 */
export function chooseTooltipAlignment(
  tickCentreX: number,
  tooltipWidthPixels: number,
  boundaryLeftX: number,
  boundaryRightX: number,
): TooltipAlignment {
  const values = [tickCentreX, tooltipWidthPixels, boundaryLeftX, boundaryRightX];
  if (!values.every(Number.isFinite) || boundaryRightX <= boundaryLeftX) {
    throw new Error(
      `A tick tooltip needs finite positions and a boundary wider than nothing, got tick centre ` +
        `${tickCentreX}, width ${tooltipWidthPixels}, boundary ${boundaryLeftX} to ${boundaryRightX}`,
    );
  }
  const halfWidthPixels = tooltipWidthPixels / 2;
  if (
    tickCentreX - halfWidthPixels >= boundaryLeftX &&
    tickCentreX + halfWidthPixels <= boundaryRightX
  ) {
    return "centre";
  }
  // Too close to the left end: run right from the tick's left edge; otherwise run left.
  return tickCentreX - boundaryLeftX < boundaryRightX - tickCentreX ? "start" : "end";
}

/** Builds a tick's tooltip, with its two lines: the marker label and "Time into match: m:ss". */
export function createTickTooltip(markerLabel: string, elapsedClock: string): HTMLElement {
  const tooltipElement = document.createElement("span");
  tooltipElement.className = "timeline-tick-tooltip";
  tooltipElement.setAttribute("aria-hidden", "true");
  tooltipElement.dataset.align = "centre";
  const labelLine = document.createElement("span");
  labelLine.className = "timeline-tick-tooltip-label";
  labelLine.textContent = markerLabel;
  const timeLine = document.createElement("span");
  timeLine.textContent = `Time into match: ${elapsedClock}`;
  tooltipElement.append(labelLine, timeLine);
  return tooltipElement;
}

/**
 * Places tickButton's tooltip within boundaryElement each time it is about to show (pointer over
 * the tick, or focus on it), and lets Escape hide it until the pointer or focus leaves.
 */
export function attachTickTooltip(
  tickButton: HTMLButtonElement,
  tooltipElement: HTMLElement,
  boundaryElement: HTMLElement,
): void {
  function placeTooltip(): void {
    const tickBox = tickButton.getBoundingClientRect();
    const boundaryBox = boundaryElement.getBoundingClientRect();
    tooltipElement.dataset.align = chooseTooltipAlignment(
      tickBox.left + tickTargetHalfWidthPixels,
      tooltipElement.getBoundingClientRect().width,
      boundaryBox.left,
      boundaryBox.right,
    );
  }
  function showAgain(): void {
    delete tickButton.dataset.tooltipDismissed;
  }
  tickButton.addEventListener("pointerenter", placeTooltip);
  tickButton.addEventListener("focus", placeTooltip);
  tickButton.addEventListener("pointerleave", showAgain);
  tickButton.addEventListener("blur", showAgain);
  tickButton.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      tickButton.dataset.tooltipDismissed = "true";
    }
  });
}
