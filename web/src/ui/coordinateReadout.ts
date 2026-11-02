import { describeWorldReadout, type WorldReadout } from "../domain/coordinateReadout";
import type { CanvasPoint, MapConfig } from "../domain/types";
import type { MapView } from "../render/mapView";

// The world-position readout in a corner of the map, so a designer can carry a spot from this map
// into their level editor. Two ways to aim:
// - Mouse (desktop): the position under the pointer, copied with the C key. There is no Copy button,
//   because moving the pointer to a button would change the position on the way there.
// - Touch (phone, no hover): the position under a crosshair fixed at the map's centre; the designer
//   pans the map to aim and copies with the Copy button.
// Off the minimap, or with nothing to aim at, it shows a dash rather than a number.

/** The parts of the map view the readout uses; MapView fits it. */
export type CoordinateReadoutMapView = Pick<
  MapView,
  "container" | "canvasPointToWorld" | "pointerEventToCanvasPoint" | "onViewMove" | "onRedraw"
>;

export interface CoordinateReadoutOptions {
  readonly mapView: CoordinateReadoutMapView;
  /** True on touch screens with no hover: aim with the centre crosshair instead of the pointer. */
  readonly isCrosshairMode: boolean;
  /** Puts text on the clipboard; a rejection is shown to the designer as "Copy failed: <reason>". */
  readonly writeClipboardText: (text: string) => Promise<void>;
}

export interface CoordinateReadout {
  /** The readout box; placed over a corner of the map. */
  readonly element: HTMLElement;
  /** The crosshair marking the map's centre; hidden unless in crosshair mode. */
  readonly crosshairElement: HTMLElement;
  /** Call whenever the map view shows a new map, so positions are checked against its bounds. */
  showMap(map: MapConfig): void;
}

const noPositionText = "—";
const statusShownMilliseconds = 2500;

function createAxisValue(axisLetter: "X" | "Z", axis: "x" | "z"): [HTMLElement, HTMLElement] {
  const axisLabel = document.createElement("span");
  axisLabel.className = "coordinate-readout-axis";
  axisLabel.textContent = axisLetter;
  const valueElement = document.createElement("span");
  valueElement.className = "coordinate-readout-value";
  valueElement.dataset.worldAxis = axis;
  valueElement.textContent = noPositionText;
  return [axisLabel, valueElement];
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest("input, select, textarea") !== null)
  );
}

/**
 * The clipboard writer the app uses. Browsers give no clipboard on plain-http pages (other than on
 * this computer), so the writer then rejects in plain words instead of failing silently.
 */
export function createClipboardWriter(
  clipboard: Clipboard | undefined,
): (text: string) => Promise<void> {
  return (text) => {
    if (clipboard === undefined) {
      return Promise.reject(
        new Error("this browser allows copying only on https pages or on this computer"),
      );
    }
    return clipboard.writeText(text);
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createCoordinateReadout(options: CoordinateReadoutOptions): CoordinateReadout {
  const { mapView, isCrosshairMode, writeClipboardText } = options;

  const element = document.createElement("div");
  element.className = "coordinate-readout";
  element.setAttribute("role", "group");
  element.setAttribute(
    "aria-label",
    isCrosshairMode ? "World position at the crosshair" : "World position under the pointer",
  );
  const caption = document.createElement("div");
  caption.className = "coordinate-readout-caption";
  caption.textContent = "World units";
  const valuesRow = document.createElement("div");
  valuesRow.className = "coordinate-readout-values";
  const [worldXLabel, worldXValue] = createAxisValue("X", "x");
  const [worldZLabel, worldZValue] = createAxisValue("Z", "z");
  valuesRow.append(worldXLabel, worldXValue, worldZLabel, worldZValue);
  const actionRow = document.createElement("div");
  actionRow.className = "coordinate-readout-actions";
  const statusElement = document.createElement("span");
  statusElement.className = "coordinate-readout-status";
  statusElement.setAttribute("aria-live", "polite");
  element.append(caption, valuesRow, actionRow);

  const crosshairElement = document.createElement("div");
  crosshairElement.className = "coordinate-readout-crosshair";
  crosshairElement.setAttribute("aria-hidden", "true");
  crosshairElement.hidden = !isCrosshairMode;

  let shownMap: MapConfig | null = null;
  let shownReadout: WorldReadout | null = null;
  // The mouse's last position over the map. It is the pointer's place on screen, not a converted
  // map point, so it stays right after a pan or zoom; it is converted to world space afresh each time.
  // If the map itself moves on the page under a still mouse (a window resize), it is off until the
  // next mouse move, which comes as soon as the designer aims again.
  let pointerCanvasPoint: CanvasPoint | null = null;
  let statusTimeoutId: number | undefined;
  let copyButton: HTMLButtonElement | null = null;

  function showStatus(message: string): void {
    window.clearTimeout(statusTimeoutId);
    statusElement.textContent = message;
    statusTimeoutId = window.setTimeout(() => {
      statusElement.textContent = "";
    }, statusShownMilliseconds);
  }

  function aimedCanvasPoint(): CanvasPoint | null {
    if (isCrosshairMode) {
      return {
        canvasX: mapView.container.clientWidth / 2,
        canvasY: mapView.container.clientHeight / 2,
      };
    }
    return pointerCanvasPoint;
  }

  function updateReadout(): void {
    const aimedPoint = aimedCanvasPoint();
    shownReadout =
      shownMap === null || aimedPoint === null
        ? null
        : describeWorldReadout(mapView.canvasPointToWorld(aimedPoint), shownMap);
    worldXValue.textContent = shownReadout === null ? noPositionText : shownReadout.worldXText;
    worldZValue.textContent = shownReadout === null ? noPositionText : shownReadout.worldZText;
    if (copyButton !== null) {
      copyButton.disabled = shownReadout === null;
    }
  }

  function copyShownReadout(): void {
    if (shownReadout === null) {
      return; // valid path: nothing is shown, so there is nothing to copy
    }
    writeClipboardText(shownReadout.copyText).then(
      () => showStatus("Copied"),
      (error: unknown) => showStatus(`Copy failed: ${describeError(error)}`),
    );
  }

  if (isCrosshairMode) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "coordinate-readout-copy";
    const hiddenText = document.createElement("span");
    hiddenText.className = "coordinate-readout-hidden-text";
    hiddenText.textContent = " world position";
    button.append("Copy", hiddenText);
    button.addEventListener("click", copyShownReadout);
    copyButton = button;
    actionRow.append(button, statusElement);
  } else {
    const hint = document.createElement("span");
    hint.className = "coordinate-readout-hint";
    hint.textContent = "Press C to copy";
    actionRow.append(hint, statusElement);
    mapView.container.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch") {
        return; // valid path: a finger pans the map; only a mouse or pen aims the readout
      }
      pointerCanvasPoint = mapView.pointerEventToCanvasPoint(event);
      updateReadout();
    });
    // Moving onto the readout box leaves the map too, so the box then shows "—" (copy with C instead).
    mapView.container.addEventListener("pointerleave", () => {
      pointerCanvasPoint = null;
      updateReadout();
    });
  }

  window.addEventListener("keydown", (event) => {
    const isPlainC = event.key.toLowerCase() === "c";
    if (!isPlainC || event.metaKey || event.ctrlKey || event.altKey) {
      return; // valid path: another key, or a shortcut such as Cmd+C that the browser owns
    }
    if (isTypingTarget(event.target) || shownReadout === null) {
      return; // valid path: typing in a field, or no position shown
    }
    event.preventDefault();
    copyShownReadout();
  });
  mapView.onViewMove(updateReadout);
  mapView.onRedraw(updateReadout);
  updateReadout();

  return {
    element,
    crosshairElement,
    showMap: (map) => {
      shownMap = map;
      updateReadout();
    },
  };
}
