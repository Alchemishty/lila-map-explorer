import { describe, expect, it } from "vitest";
import {
  busiestZoneScaleBarStartPercent,
  heatmapBusiestZoneFraction,
  heatRampColorForFraction,
  heatRampCssGradient,
  heatRampStops,
  heatmapFaintCutoffFraction,
  type RgbaColor,
} from "./heatRamp";

function cssColor(color: RgbaColor): string {
  return `rgba(${color.red}, ${color.green}, ${color.blue}, ${color.alpha})`;
}

describe("heatRampStops", () => {
  it("are the approved stops, light and clear to dark red", () => {
    expect(heatRampStops).toEqual([
      { fraction: 0, color: { red: 255, green: 237, blue: 160, alpha: 0 } },
      { fraction: 0.12, color: { red: 254, green: 217, blue: 118, alpha: 0.45 } },
      { fraction: 0.35, color: { red: 253, green: 141, blue: 60, alpha: 0.7 } },
      { fraction: 0.65, color: { red: 227, green: 26, blue: 28, alpha: 0.82 } },
      { fraction: 1, color: { red: 110, green: 0, blue: 30, alpha: 0.92 } },
    ]);
    expect(heatmapFaintCutoffFraction).toBe(0.04);
  });
});

describe("heatRampColorForFraction", () => {
  it("returns each stop's exact colour at its fraction", () => {
    for (const stop of heatRampStops) {
      expect(heatRampColorForFraction(stop.fraction)).toEqual(stop.color);
    }
  });

  it("interpolates linearly between stops", () => {
    const halfwayColor = heatRampColorForFraction(0.235);
    expect(halfwayColor.red).toBeCloseTo(253.5, 9);
    expect(halfwayColor.green).toBeCloseTo(179, 9);
    expect(halfwayColor.blue).toBeCloseTo(89, 9);
    expect(halfwayColor.alpha).toBeCloseTo(0.575, 9);
  });

  it("refuses a fraction outside 0 to 1", () => {
    expect(() => heatRampColorForFraction(1.5)).toThrow("between 0 and 1");
    expect(() => heatRampColorForFraction(-0.1)).toThrow("between 0 and 1");
    expect(() => heatRampColorForFraction(Number.NaN)).toThrow("between 0 and 1");
  });
});

describe("heatRampCssGradient", () => {
  it("runs left to right from the cut-off colour to the darkest stop", () => {
    const gradient = heatRampCssGradient();
    expect(gradient.startsWith("linear-gradient(to right, ")).toBe(true);
    expect(gradient).toContain(cssColor(heatRampColorForFraction(heatmapFaintCutoffFraction)));
    expect(
      gradient.endsWith(`${cssColor({ red: 110, green: 0, blue: 30, alpha: 0.92 })} 100%)`),
    ).toBe(true);
    expect(gradient).not.toContain("rgba(255, 237, 160, 0)");
  });

  it("places the five drawn stops evenly along the bar, at 0, 25, 50, 75 and 100%", () => {
    const stopPercents = [...heatRampCssGradient().matchAll(/\) (\d+(?:\.\d+)?)%/g)].map((match) =>
      Number(match[1]),
    );
    expect(stopPercents).toEqual([0, 25, 50, 75, 100]);
  });
});

describe("busiest zones", () => {
  it("start at the ramp's red stop, 0.65 of the top value", () => {
    expect(heatmapBusiestZoneFraction).toBe(0.65);
    expect(heatRampStops.map((stop) => stop.fraction)).toContain(heatmapBusiestZoneFraction);
  });

  it("start on the scale bar where the gradient shows that stop", () => {
    expect(busiestZoneScaleBarStartPercent()).toBe(75);
    expect(heatRampCssGradient()).toContain(
      `${cssColor(heatRampColorForFraction(heatmapBusiestZoneFraction))} 75%`,
    );
  });
});
