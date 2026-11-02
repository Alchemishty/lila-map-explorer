// Test-only fixtures for the render tests; never imported by app code.
import type { DrawingContext } from "./canvasOverlay";

type PaintStyle = string | CanvasGradient | CanvasPattern;

interface DrawingState {
  readonly fillStyle: PaintStyle;
  readonly strokeStyle: PaintStyle;
  readonly lineWidth: number;
  readonly globalAlpha: number;
  readonly lineDash: readonly number[];
}

export interface RecordedDrawCall {
  readonly methodName: string;
  readonly argumentValues: readonly unknown[];
  readonly fillStyle: PaintStyle;
  readonly strokeStyle: PaintStyle;
  readonly lineWidth: number;
  readonly globalAlpha: number;
  readonly lineDash: readonly number[];
}

export interface RecordingContext extends DrawingContext {
  readonly recordedCalls: RecordedDrawCall[];
}

/** A DrawingContext that records every method call with the drawing state at that moment. */
export function createRecordingContext(): RecordingContext {
  let currentLineDash: readonly number[] = [];
  const savedStates: DrawingState[] = [];
  const recordedCalls: RecordedDrawCall[] = [];
  const recordingContext: RecordingContext & {
    record(methodName: string, argumentValues: readonly unknown[]): void;
  } = {
    recordedCalls,
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    globalAlpha: 1,
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    record(methodName: string, argumentValues: readonly unknown[]): void {
      recordingContext.recordedCalls.push({
        methodName,
        argumentValues,
        fillStyle: recordingContext.fillStyle,
        strokeStyle: recordingContext.strokeStyle,
        lineWidth: recordingContext.lineWidth,
        globalAlpha: recordingContext.globalAlpha,
        lineDash: [...currentLineDash],
      });
    },
    save(): void {
      savedStates.push({
        fillStyle: recordingContext.fillStyle,
        strokeStyle: recordingContext.strokeStyle,
        lineWidth: recordingContext.lineWidth,
        globalAlpha: recordingContext.globalAlpha,
        lineDash: [...currentLineDash],
      });
      recordingContext.record("save", []);
    },
    restore(): void {
      const savedState = savedStates.pop();
      if (savedState === undefined) {
        throw new Error("restore() was called more times than save()");
      }
      recordingContext.fillStyle = savedState.fillStyle;
      recordingContext.strokeStyle = savedState.strokeStyle;
      recordingContext.lineWidth = savedState.lineWidth;
      recordingContext.globalAlpha = savedState.globalAlpha;
      currentLineDash = savedState.lineDash;
      recordingContext.record("restore", []);
    },
    setLineDash(segments: number[]): void {
      currentLineDash = [...segments];
      recordingContext.record("setLineDash", [segments]);
    },
    beginPath: (): void => recordingContext.record("beginPath", []),
    closePath: (): void => recordingContext.record("closePath", []),
    moveTo: (canvasX: number, canvasY: number): void =>
      recordingContext.record("moveTo", [canvasX, canvasY]),
    lineTo: (canvasX: number, canvasY: number): void =>
      recordingContext.record("lineTo", [canvasX, canvasY]),
    arc: (canvasX: number, canvasY: number, radiusPixels: number): void =>
      recordingContext.record("arc", [canvasX, canvasY, radiusPixels]),
    rect: (canvasX: number, canvasY: number, widthPixels: number, heightPixels: number): void =>
      recordingContext.record("rect", [canvasX, canvasY, widthPixels, heightPixels]),
    fillRect: (canvasX: number, canvasY: number, widthPixels: number, heightPixels: number): void =>
      recordingContext.record("fillRect", [canvasX, canvasY, widthPixels, heightPixels]),
    drawImage: (...drawImageArguments: unknown[]): void =>
      recordingContext.record("drawImage", drawImageArguments),
    fill: (): void => recordingContext.record("fill", []),
    stroke: (): void => recordingContext.record("stroke", []),
  };
  return recordingContext;
}

/** The recorded calls of one method, in call order. */
export function callsNamed(
  recordingContext: RecordingContext,
  methodName: string,
): RecordedDrawCall[] {
  return recordingContext.recordedCalls.filter((call) => call.methodName === methodName);
}
