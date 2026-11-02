import { describe, expect, it } from "vitest";
import { DataContractError } from "./contract";
import type { MapEvent } from "./events";
import { eventsUpTo, timelineTicks } from "./playback";
import { matchStartTimestampSeconds, testMatch } from "./playbackTestFixtures";

function buildEvent(markerKey: string, elapsedSeconds: number, matchId = "match-1"): MapEvent {
  return {
    matchId,
    actorKey: "player-a",
    actorType: "human",
    eventCode: "Kill",
    category: "kill",
    markerKey,
    otherParty: "player",
    isPerformedByBot: false,
    position: { worldX: 0, worldZ: 0 },
    timestampSeconds: matchStartTimestampSeconds + elapsedSeconds,
    isSameTickRepeat: false,
  };
}

describe("eventsUpTo", () => {
  it("keeps events at or before now, sorted by the time they happened", () => {
    const events = [
      buildEvent("loot", 50),
      buildEvent("loot", 20),
      buildEvent("kill_player", 10),
      buildEvent("kill_bot", 15),
    ];
    expect(eventsUpTo(events, 20, matchStartTimestampSeconds)).toEqual([
      events[2],
      events[3],
      events[1],
    ]);
  });

  it("keeps events in the same second in their input order", () => {
    const events = [
      buildEvent("kill_player", 30),
      buildEvent("loot", 5),
      buildEvent("kill_bot", 30),
    ];
    expect(eventsUpTo(events, 30, matchStartTimestampSeconds)).toEqual([
      events[1],
      events[0],
      events[2],
    ]);
  });

  it("does not reorder the input array", () => {
    const events = [buildEvent("loot", 50), buildEvent("loot", 10)];
    eventsUpTo(events, 60, matchStartTimestampSeconds);
    expect(events.map((mapEvent) => mapEvent.timestampSeconds)).toEqual([
      matchStartTimestampSeconds + 50,
      matchStartTimestampSeconds + 10,
    ]);
  });

  it("throws on a non-finite elapsed time", () => {
    expect(() =>
      eventsUpTo([buildEvent("loot", 1)], Number.NaN, matchStartTimestampSeconds),
    ).toThrow(/NaN/);
    expect(() =>
      eventsUpTo([buildEvent("loot", 1)], Number.POSITIVE_INFINITY, matchStartTimestampSeconds),
    ).toThrow(/Infinity/);
  });

  it("gives nothing before the first event", () => {
    expect(eventsUpTo([buildEvent("loot", 1)], 0, matchStartTimestampSeconds)).toEqual([]);
  });
});

describe("timelineTicks", () => {
  it("gives fraction 0.5 for an event at mid-match", () => {
    expect(timelineTicks([buildEvent("kill_player", 300)], testMatch)).toEqual([
      { fraction: 0.5, markerKey: "kill_player", elapsedSeconds: 300 },
    ]);
  });

  it("gives 0 and 1 for events at the start and the end", () => {
    const ticks = timelineTicks([buildEvent("loot", 0), buildEvent("loot", 600)], testMatch);
    expect(ticks.map((tick) => tick.fraction)).toEqual([0, 1]);
  });

  it("lists ticks in the order the events happened, same-second events in input order", () => {
    const events = [
      buildEvent("loot", 450),
      buildEvent("kill_player", 150),
      buildEvent("bot_kill", 450),
      buildEvent("kill_bot", 0),
    ];
    expect(timelineTicks(events, testMatch)).toEqual([
      { fraction: 0, markerKey: "kill_bot", elapsedSeconds: 0 },
      { fraction: 0.25, markerKey: "kill_player", elapsedSeconds: 150 },
      { fraction: 0.75, markerKey: "loot", elapsedSeconds: 450 },
      { fraction: 0.75, markerKey: "bot_kill", elapsedSeconds: 450 },
    ]);
  });

  it("throws for a zero-length match, which the build step rejects", () => {
    const zeroLengthMatch = { ...testMatch, durationSeconds: 0 };
    expect(() => timelineTicks([buildEvent("loot", 0)], zeroLengthMatch)).toThrow(
      DataContractError,
    );
    expect(() => timelineTicks([buildEvent("loot", 0)], zeroLengthMatch)).toThrow(
      /match-1.*length 0/,
    );
  });

  it("throws for an event outside the match's time span", () => {
    expect(() => timelineTicks([buildEvent("loot", 601)], testMatch)).toThrow(DataContractError);
    expect(() => timelineTicks([buildEvent("loot", -1)], testMatch)).toThrow(/match-1/);
  });

  it("throws for an event from another match", () => {
    expect(() => timelineTicks([buildEvent("loot", 10, "match-2")], testMatch)).toThrow(/match-2/);
  });
});
