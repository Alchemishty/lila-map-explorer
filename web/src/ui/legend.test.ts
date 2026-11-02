import { describe, expect, it } from "vitest";
import { legendEntries } from "./legend";
import { fixtureEventConfig } from "./overviewTestFixtures";

describe("legendEntries", () => {
  it("lists the 6 player-side markers in config order, with their config labels", () => {
    expect(
      legendEntries(fixtureEventConfig, "player").map((entry) => [
        entry.markerKey,
        entry.style.label,
      ]),
    ).toEqual([
      ["kill_player", "Player killed a player"],
      ["kill_bot", "Player killed a bot"],
      ["death_by_player", "Player killed by a player"],
      ["death_by_bot", "Player killed by a bot"],
      ["storm_death", "Player died to storm"],
      ["loot", "Player looted"],
    ]);
  });

  it("adds the 2 bot-event markers for all", () => {
    const entries = legendEntries(fixtureEventConfig, "all");
    expect(entries.map((entry) => entry.markerKey)).toEqual([
      "kill_player",
      "kill_bot",
      "death_by_player",
      "death_by_bot",
      "storm_death",
      "loot",
      "bot_kill",
      "bot_death",
    ]);
    expect(entries.slice(6).map((entry) => entry.style.outline)).toEqual(["dashed", "dashed"]);
  });

  it("throws, naming the marker, when a rule points at a marker the config does not define", () => {
    const markersWithoutLoot = Object.fromEntries(
      Object.entries(fixtureEventConfig.markers).filter(([markerKey]) => markerKey !== "loot"),
    );
    expect(() =>
      legendEntries({ ...fixtureEventConfig, markers: markersWithoutLoot }, "player"),
    ).toThrow('Marker "loot" (used by the player rule for "Loot") has no style in eventConfig');
  });
});
