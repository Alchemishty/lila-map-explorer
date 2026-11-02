import { describe, expect, it } from "vitest";
import { chooseTooltipAlignment } from "./tickTooltip";

// Where a timeline tick's tooltip goes so it stays inside the timeline (a 390 px phone here).

describe("chooseTooltipAlignment", () => {
  it("centres the tooltip on the tick when it fits", () => {
    expect(chooseTooltipAlignment(195, 230, 0, 390)).toBe("centre");
    expect(chooseTooltipAlignment(115, 230, 0, 390)).toBe("centre"); // exactly fits on the left
  });

  it("runs right from the tick when centring would cross the left edge", () => {
    expect(chooseTooltipAlignment(114, 230, 0, 390)).toBe("start");
    expect(chooseTooltipAlignment(20, 230, 0, 390)).toBe("start");
  });

  it("runs left from the tick when centring would cross the right edge", () => {
    expect(chooseTooltipAlignment(276, 230, 0, 390)).toBe("end");
    expect(chooseTooltipAlignment(370, 230, 0, 390)).toBe("end");
  });

  it("throws for positions that are not finite or an empty boundary", () => {
    expect(() => chooseTooltipAlignment(Number.NaN, 230, 0, 390)).toThrow("tick centre NaN");
    expect(() => chooseTooltipAlignment(100, 230, 390, 390)).toThrow("boundary 390 to 390");
  });
});
