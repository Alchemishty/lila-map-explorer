import type { TrailHeadState } from "../domain/trailHeadState";
import { drawTrailHead, type TrailStyle } from "../render/drawTrails";

// Replay's key to trail head states (telemetry audit issue 9): what each head drawing means, so a
// designer never reads "last recorded here" as "standing here now".

export interface TrailHeadStateWording {
  readonly label: string;
  readonly description: string;
}

/** Every head state, in the order the key lists them. */
const keyedHeadStates: readonly TrailHeadState[] = ["moving", "waiting", "dead", "last_seen"];

export const trailHeadStateWordings: Readonly<Record<TrailHeadState, TrailHeadStateWording>> = {
  moving: { label: "Moving", description: "Between two recorded positions." },
  waiting: {
    label: "Waiting (alive)",
    description: "Recorded at this exact spot again later, so still alive here.",
  },
  dead: { label: "Dead here", description: "A death is recorded." },
  last_seen: {
    label: "Last seen here",
    description: "No more rows and no death recorded. What happened next is unknown.",
  },
};

/** The followed actor's state line, for the Replay inspector. */
export function describeHeadStateNow(headState: TrailHeadState | null): string {
  return `Now: ${headState === null ? "Not recorded yet" : trailHeadStateWordings[headState].label}`;
}

const swatchSizePixels = 24;
const swatchStyle: TrailStyle = {
  color: "#22d3ee",
  isDashed: false,
  isHighlighted: false,
  isDimmed: false,
  headShape: "round",
};

function requireSwatchContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("The trail head key could not get a 2D drawing context for its swatch");
  }
  return context;
}

function createKeyRow(headState: TrailHeadState): HTMLLIElement {
  const rowElement = document.createElement("li");
  rowElement.className = "trail-head-key-row";
  rowElement.dataset.headState = headState;
  const swatch = document.createElement("canvas");
  swatch.className = "trail-head-swatch";
  swatch.setAttribute("aria-hidden", "true");
  const pixelRatio = window.devicePixelRatio;
  swatch.width = swatchSizePixels * pixelRatio;
  swatch.height = swatchSizePixels * pixelRatio;
  swatch.style.width = `${swatchSizePixels}px`;
  swatch.style.height = `${swatchSizePixels}px`;
  const context = requireSwatchContext(swatch);
  context.scale(pixelRatio, pixelRatio);
  const center = swatchSizePixels / 2;
  drawTrailHead(
    context,
    { at: { canvasX: center, canvasY: center }, state: headState },
    swatchStyle,
  );
  const wording = trailHeadStateWordings[headState];
  const textElement = document.createElement("span");
  const labelElement = document.createElement("strong");
  labelElement.textContent = wording.label;
  textElement.append(labelElement, document.createTextNode(`: ${wording.description}`));
  rowElement.append(swatch, textElement);
  return rowElement;
}

/**
 * A list of every head state with its drawing, label and meaning. Squares mean bots. It folds under
 * its "Trail heads" summary, which keeps the panel short; it starts folded, and the summary's
 * marker shows it can open.
 */
export function createTrailHeadKey(): HTMLDetailsElement {
  const keyElement = document.createElement("details");
  keyElement.className = "trail-head-key";
  const summaryElement = document.createElement("summary");
  summaryElement.textContent = "Trail heads";
  const listElement = document.createElement("ul");
  listElement.append(...keyedHeadStates.map(createKeyRow));
  const noteElement = document.createElement("p");
  noteElement.textContent = "Round heads are players and square heads are bots.";
  keyElement.append(summaryElement, listElement, noteElement);
  return keyElement;
}
