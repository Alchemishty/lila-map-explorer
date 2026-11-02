// The heatmap colour ramp (docs/domain.md, "How heatmaps are drawn"): pale and clear for little, through orange
// and red, to dark red for the busiest zone. The map and the colour scale both use these stops.

/** A colour with 0–255 channels and 0–1 opacity. */
export interface RgbaColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

export interface HeatRampStop {
  /** Share of the grid's top smoothed value, 0 to 1. */
  readonly fraction: number;
  readonly color: RgbaColor;
}

/**
 * From this share of the top value the ramp is red going to dark red: the busiest zones, which the
 * map outlines so they stay visible on dark terrain (user decision 2026-11-02).
 */
export const heatmapBusiestZoneFraction = 0.65;

export const heatRampStops: readonly HeatRampStop[] = [
  { fraction: 0, color: { red: 255, green: 237, blue: 160, alpha: 0 } },
  { fraction: 0.12, color: { red: 254, green: 217, blue: 118, alpha: 0.45 } },
  { fraction: 0.35, color: { red: 253, green: 141, blue: 60, alpha: 0.7 } },
  { fraction: heatmapBusiestZoneFraction, color: { red: 227, green: 26, blue: 28, alpha: 0.82 } },
  { fraction: 1, color: { red: 110, green: 0, blue: 30, alpha: 0.92 } },
];

/** Smoothed values below this share of the top value are not drawn, so quiet ground stays clear. */
export const heatmapFaintCutoffFraction = 0.04;

function interpolate(lowValue: number, highValue: number, position: number): number {
  return lowValue + (highValue - lowValue) * position;
}

/** The ramp colour for a share of the top value, linear between the stops. */
export function heatRampColorForFraction(fraction: number): RgbaColor {
  if (!(fraction >= 0 && fraction <= 1)) {
    throw new Error(`A heat colour needs a fraction between 0 and 1, got ${fraction}`);
  }
  for (let stopIndex = 1; stopIndex < heatRampStops.length; stopIndex += 1) {
    const lowStop = heatRampStops[stopIndex - 1];
    const highStop = heatRampStops[stopIndex];
    if (lowStop === undefined || highStop === undefined) {
      throw new Error(`The heat ramp has no stop ${stopIndex}`);
    }
    if (fraction <= highStop.fraction) {
      const position = (fraction - lowStop.fraction) / (highStop.fraction - lowStop.fraction);
      if (position === 1) {
        return highStop.color;
      }
      if (position === 0) {
        return lowStop.color;
      }
      return {
        red: interpolate(lowStop.color.red, highStop.color.red, position),
        green: interpolate(lowStop.color.green, highStop.color.green, position),
        blue: interpolate(lowStop.color.blue, highStop.color.blue, position),
        alpha: interpolate(lowStop.color.alpha, highStop.color.alpha, position),
      };
    }
  }
  throw new Error(`The heat ramp does not reach fraction ${fraction}`);
}

function toCssColor(color: RgbaColor): string {
  return `rgba(${color.red}, ${color.green}, ${color.blue}, ${color.alpha})`;
}

/** The drawn part of the ramp, from the cut-off to the darkest stop, in order. */
function drawnRampStops(): HeatRampStop[] {
  return [
    {
      fraction: heatmapFaintCutoffFraction,
      color: heatRampColorForFraction(heatmapFaintCutoffFraction),
    },
    ...heatRampStops.filter((stop) => stop.fraction > heatmapFaintCutoffFraction),
  ];
}

/** Where the scale bar shows a drawn stop: the stops sit evenly along the bar, first at 0%. */
function scaleBarPercentOfStop(stopIndex: number, stopCount: number): number {
  return (stopIndex / (stopCount - 1)) * 100;
}

/** A CSS gradient of the drawn part of the ramp, from the cut-off to the darkest stop. */
export function heatRampCssGradient(): string {
  const drawnStops = drawnRampStops();
  const colorStops = drawnStops.map(
    (stop, stopIndex) =>
      `${toCssColor(stop.color)} ${scaleBarPercentOfStop(stopIndex, drawnStops.length)}%`,
  );
  return `linear-gradient(to right, ${colorStops.join(", ")})`;
}

/** Where the busiest zones start on the colour scale bar, as a percent of its width from the left. */
export function busiestZoneScaleBarStartPercent(): number {
  const drawnStops = drawnRampStops();
  const busiestStopIndex = drawnStops.findIndex(
    (stop) => stop.fraction === heatmapBusiestZoneFraction,
  );
  if (busiestStopIndex === -1) {
    throw new Error(
      `The heat ramp has no drawn stop at the busiest-zone share ${heatmapBusiestZoneFraction}`,
    );
  }
  return scaleBarPercentOfStop(busiestStopIndex, drawnStops.length);
}
