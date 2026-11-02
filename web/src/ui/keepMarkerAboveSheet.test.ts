import { describe, expect, it } from "vitest";
import { distanceToLiftAboveCover, markerClearanceAboveSheetPixels } from "./keepMarkerAboveSheet";

describe("distanceToLiftAboveCover", () => {
  it("lifts a covered marker until it sits the clearance above the sheet's top edge", () => {
    expect(distanceToLiftAboveCover(500, 400)).toBe(100 + markerClearanceAboveSheetPixels);
  });

  it("lifts a marker inside the clearance band by what is missing", () => {
    expect(distanceToLiftAboveCover(390, 400)).toBe(markerClearanceAboveSheetPixels - 10);
  });

  it("leaves a marker that is already clear where it is", () => {
    expect(distanceToLiftAboveCover(400 - markerClearanceAboveSheetPixels, 400)).toBe(0);
    expect(distanceToLiftAboveCover(10, 400)).toBe(0);
  });

  it("throws, naming the values, for a position that is not a finite number", () => {
    expect(() => distanceToLiftAboveCover(Number.NaN, 400)).toThrow("marker y NaN");
    expect(() => distanceToLiftAboveCover(10, Number.POSITIVE_INFINITY)).toThrow(
      "sheet top y Infinity",
    );
  });
});
