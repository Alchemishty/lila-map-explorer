import { describe, expect, it } from "vitest";
import { formatHeatmapScaleTitle, formatTrafficDuration, heatmapChoices } from "./heatmapChoices";

describe("heatmapChoices", () => {
  it("lists the approved names and descriptions in order", () => {
    expect(
      heatmapChoices.map((choice) => [choice.heatmapKind, choice.label, choice.description]),
    ).toEqual([
      [null, "Off", ""],
      ["kills", "Kill zones", "Where players stood when they made a kill"],
      ["combatDeaths", "Combat death zones", "Where players were killed by a player or a bot"],
      ["stormDeaths", "Storm death zones", "Where players died to the storm"],
      ["traffic", "Traffic", "Where players spent the most time"],
    ]);
  });
});

describe("formatHeatmapScaleTitle", () => {
  it("names the heatmap and the exact count behind it, with thousands separators", () => {
    expect(formatHeatmapScaleTitle("kills", 1671)).toBe("Kill zones · 1,671 kills");
    expect(formatHeatmapScaleTitle("combatDeaths", 299)).toBe(
      "Combat death zones · 299 combat deaths",
    );
    expect(formatHeatmapScaleTitle("stormDeaths", 17)).toBe("Storm death zones · 17 storm deaths");
  });

  it("uses the singular for one and the plural for zero", () => {
    expect(formatHeatmapScaleTitle("kills", 1)).toBe("Kill zones · 1 kill");
    expect(formatHeatmapScaleTitle("stormDeaths", 1)).toBe("Storm death zones · 1 storm death");
    expect(formatHeatmapScaleTitle("stormDeaths", 0)).toBe("Storm death zones · 0 storm deaths");
  });

  it("gives traffic as play time", () => {
    expect(formatHeatmapScaleTitle("traffic", 1_483_500)).toBe("Traffic · 412 h 5 min of play");
  });

  it("refuses an event count that is not a whole number of zero or more", () => {
    expect(() => formatHeatmapScaleTitle("kills", 2.5)).toThrow("whole number");
    expect(() => formatHeatmapScaleTitle("kills", -1)).toThrow("whole number");
  });
});

describe("formatTrafficDuration", () => {
  it("shows hours and minutes from one hour, minutes and seconds below, rounded down", () => {
    expect(formatTrafficDuration(3599.9)).toBe("59 min 59 s");
    expect(formatTrafficDuration(3600)).toBe("1 h 0 min");
    expect(formatTrafficDuration(0)).toBe("0 min 0 s");
    expect(formatTrafficDuration(36_000_000)).toBe("10,000 h 0 min");
  });

  it("refuses a negative or non-finite duration", () => {
    expect(() => formatTrafficDuration(-1)).toThrow("zero or more seconds");
    expect(() => formatTrafficDuration(Number.NaN)).toThrow("zero or more seconds");
  });
});
