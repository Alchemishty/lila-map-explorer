# Enforcement: Tests Required

**Rule:** Every change includes tests. A bug fix includes a test that fails before the fix and passes after. A change without tests does not count as done.

**Why:** Accuracy is the product. Coordinate mapping, each cleaning rule, multiplayer behavior, filters, heatmap summing and playback timing must stay provably right.

## Violations

### New logic, no test
```ts
// VIOLATION: adds domain/traffic.ts, no traffic.test.ts
// REQUIRED: traffic.test.ts covering gaps, post-death samples, last sample adds no time
```
```python
# VIOLATION: adds a cleaning rule in clean.py with no case in test_clean.py
# REQUIRED: a small fixture that triggers the rule, and one that must not
```

### Bug fix, no regression test
```ts
// VIOLATION: fix mapping for GrandRift without a test
// REQUIRED
it("uses the real image width and height for non-square GrandRift", () => {
  const pixel = worldToPixel(worldPoint, grandRiftConfig) // grandRiftConfig.imageWidthPixels 2160, imageHeightPixels 2158;
  expect(pixel.pixelY).toBeCloseTo(expectedPixelY);
});
```
```python
# REQUIRED
def test_second_copy_of_file_in_other_day_folder_is_dropped(tmp_path): ...
```

### Weak tests
```ts
// VIOLATION
expect(result).toBeDefined();
// REQUIRED: assert exact values
expect(result.get(cellKey)).toBe(3);
```

## Tests that must exist

- Coordinate mapping, including world (-301.45, -355.55) on AmbroseValley giving pixel (78, 890) on a 1024 image, and correct scaling for real image sizes.
- Each cleaning rule in `docs/domain.md`, against small fixtures.
- A made-up multiplayer match (several players, player-vs-player kills, bots) through the build step and the app logic.
- Filters, heatmap summing and playback timing.
- Review-focus cases: empty filter result, match crossing midnight UTC, actors with 0 or 1 samples, state reset on changing match/mode/filter, non-square image and edge points.

## Checking

For each changed file ask: where is the test? Does it assert exact values? Does a bug fix have a failing-first regression test? Did `make check` pass?
