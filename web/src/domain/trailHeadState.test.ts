import { describe, expect, it } from "vitest";
import { DataContractError } from "./contract";
import { trailHeadStateAt } from "./trailHeadState";
import { buildTrack, eventConfig } from "./trafficTestFixtures";

const matchStartTimestampSeconds = 1000;

describe("trailHeadStateAt", () => {
  const playerTrack = buildTrack("player-1", "human", [
    ["Position", 1000, 0, 0],
    ["Position", 1005, 10, 0], // moving
    ["Position", 1035, 10, 0], // waiting: same spot 30 s later
    ["Position", 1335, 18, 0], // slow movement over 300 s is still moving
    ["Loot", 1340, 18, 0], // waiting until the loot at the same spot
  ]);

  it("has no state before the actor's first row, or for an actor with no rows", () => {
    const lateTrack = buildTrack("late", "human", [["Position", 1010, 0, 0]]);
    expect(trailHeadStateAt(lateTrack, 5, matchStartTimestampSeconds, eventConfig)).toBeNull();
    const emptyTrack = buildTrack("empty", "human", []);
    expect(trailHeadStateAt(emptyTrack, 5, matchStartTimestampSeconds, eventConfig)).toBeNull();
  });

  it("is moving between rows at different positions, however slowly", () => {
    expect(trailHeadStateAt(playerTrack, 2, matchStartTimestampSeconds, eventConfig)).toBe(
      "moving",
    );
    expect(trailHeadStateAt(playerTrack, 200, matchStartTimestampSeconds, eventConfig)).toBe(
      "moving",
    );
  });

  it("is waiting between rows at exactly the same world X and Z, whatever the later row is", () => {
    expect(trailHeadStateAt(playerTrack, 5, matchStartTimestampSeconds, eventConfig)).toBe(
      "waiting",
    );
    expect(trailHeadStateAt(playerTrack, 20, matchStartTimestampSeconds, eventConfig)).toBe(
      "waiting",
    );
    expect(trailHeadStateAt(playerTrack, 337, matchStartTimestampSeconds, eventConfig)).toBe(
      "waiting",
    );
  });

  it("is last seen from the final row on when no death is recorded", () => {
    expect(trailHeadStateAt(playerTrack, 340, matchStartTimestampSeconds, eventConfig)).toBe(
      "last_seen",
    );
    expect(trailHeadStateAt(playerTrack, 900, matchStartTimestampSeconds, eventConfig)).toBe(
      "last_seen",
    );
  });

  it("waits before a death at the same spot, then is dead from the death on, rows after it included", () => {
    const campingTrack = buildTrack("camper", "human", [
      ["Position", 1000, 5, 5],
      ["KilledByStorm", 1454, 5, 5],
      ["Position", 1456, 5.5, 5], // a small drift after death (audit issue 3)
    ]);
    expect(trailHeadStateAt(campingTrack, 100, matchStartTimestampSeconds, eventConfig)).toBe(
      "waiting",
    );
    expect(trailHeadStateAt(campingTrack, 454, matchStartTimestampSeconds, eventConfig)).toBe(
      "dead",
    );
    expect(trailHeadStateAt(campingTrack, 455, matchStartTimestampSeconds, eventConfig)).toBe(
      "dead",
    );
    expect(trailHeadStateAt(campingTrack, 900, matchStartTimestampSeconds, eventConfig)).toBe(
      "dead",
    );
  });

  it("moves toward a death at a different spot, and counts combat deaths as deaths", () => {
    const fightTrack = buildTrack("fighter", "human", [
      ["Position", 1000, 0, 0],
      ["BotKilled", 1004, 3, 0],
    ]);
    expect(trailHeadStateAt(fightTrack, 2, matchStartTimestampSeconds, eventConfig)).toBe("moving");
    expect(trailHeadStateAt(fightTrack, 4, matchStartTimestampSeconds, eventConfig)).toBe("dead");
  });

  it("reads a bot's rows with the bot rules, so a bot's BotKilled is its death", () => {
    const botTrack = buildTrack("bot-1", "bot", [
      ["BotPosition", 1000, 0, 0],
      ["BotKill", 1003, 1, 0],
      ["BotKilled", 1006, 1, 0],
    ]);
    expect(trailHeadStateAt(botTrack, 3, matchStartTimestampSeconds, eventConfig)).toBe("waiting");
    expect(trailHeadStateAt(botTrack, 7, matchStartTimestampSeconds, eventConfig)).toBe("dead");
  });

  it("uses the last of several same-second rows, so a death in the current second counts", () => {
    const tradeTrack = buildTrack("trader", "human", [
      ["Position", 1000, 0, 0],
      ["Kill", 1002, 1, 1],
      ["Killed", 1002, 1, 1],
    ]);
    expect(trailHeadStateAt(tradeTrack, 2, matchStartTimestampSeconds, eventConfig)).toBe("dead");
  });

  it("throws a DataContractError naming the actor for an event code with no rule", () => {
    const brokenTrack = buildTrack("broken", "bot", [["Position", 1000, 0, 0]]);
    expect(() =>
      trailHeadStateAt(brokenTrack, 0, matchStartTimestampSeconds, eventConfig),
    ).toThrowError(DataContractError);
    expect(() =>
      trailHeadStateAt(brokenTrack, 0, matchStartTimestampSeconds, eventConfig),
    ).toThrowError(/Actor "broken": event code "Position" has no rule in the bot section/);
  });

  it("throws for a non-finite clock", () => {
    expect(() =>
      trailHeadStateAt(playerTrack, Number.NaN, matchStartTimestampSeconds, eventConfig),
    ).toThrowError(/must be finite/);
  });
});
