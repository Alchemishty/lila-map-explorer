import { describe, expect, it } from "vitest";
import { shortActorKey } from "./actorList";
import {
  describeMarkerEvent,
  describeMarkerEventWithoutTime,
  sameTickRepeatNoteText,
} from "./replayInspector";
import { multiplayerMatch, quietMatch, requireMultiplayerEvent } from "./replayTestFixtures";
import { formatElapsedClock, formatTimelineClock } from "./timeline";

// Replay's text: the marker inspector, the timeline clock and the
// actor list's short keys.

describe("describeMarkerEvent", () => {
  it("gives a player's kill of a bot its time, player, other party and the multi-kill note", () => {
    expect(describeMarkerEvent(requireMultiplayerEvent("kill_bot"), multiplayerMatch)).toEqual([
      "Time into match: 0:10",
      "Player: player-a-0f3c9e2d",
      "Victim: a bot",
      sameTickRepeatNoteText,
    ]);
    expect(sameTickRepeatNoteText).toBe(
      "Logged more than once in the same second at the same spot. May be a multi-kill.",
    );
  });

  it("says when the other party was a player, or was not recorded for a bot's event", () => {
    expect(
      describeMarkerEvent(requireMultiplayerEvent("death_by_player"), multiplayerMatch),
    ).toEqual(["Time into match: 0:05", "Player: player-b", "Killer: a player"]);
    expect(describeMarkerEvent(requireMultiplayerEvent("bot_kill"), multiplayerMatch)).toEqual([
      "Time into match: 0:20",
      "Bot: bot-1",
      "Victim: not recorded",
    ]);
  });

  it("has no other-party line for loot and storm deaths", () => {
    expect(describeMarkerEvent(requireMultiplayerEvent("loot"), multiplayerMatch)).toEqual([
      "Time into match: 0:15",
      "Player: player-a-0f3c9e2d",
    ]);
  });

  it("names the counterpart for both player kill/death types and bot deaths", () => {
    const playerKill = requireMultiplayerEvent("kill_player");
    const playerDeath = requireMultiplayerEvent("death_by_player");
    expect(describeMarkerEvent(playerKill, multiplayerMatch)).toContain("Victim: a player");
    expect(describeMarkerEvent({ ...playerDeath, otherParty: "bot" }, multiplayerMatch)).toContain(
      "Killer: a bot",
    );
    expect(describeMarkerEvent(requireMultiplayerEvent("bot_death"), multiplayerMatch)).toContain(
      "Killer: not recorded",
    );
    expect(
      describeMarkerEvent(
        { ...playerDeath, otherParty: "none", category: "storm_death" },
        multiplayerMatch,
      ),
    ).toEqual(["Time into match: 0:05", "Player: player-b"]);
  });

  it("throws rather than guessing a counterpart role for an unknown category", () => {
    expect(() =>
      describeMarkerEvent(
        {
          ...requireMultiplayerEvent("kill_bot"),
          category: "unrecognized_combat",
        },
        multiplayerMatch,
      ),
    ).toThrow('category "unrecognized_combat" has no known Victim/Killer role');
  });

  it("throws for an event from another match", () => {
    expect(() => describeMarkerEvent(requireMultiplayerEvent("loot"), quietMatch)).toThrow(
      'The marker inspector for match "quiet" was given an event from match "multiplayer"',
    );
  });
});

describe("describeMarkerEventWithoutTime", () => {
  it("gives the same lines as a single marker, without the time a stacked row's summary shows", () => {
    expect(
      describeMarkerEventWithoutTime(requireMultiplayerEvent("kill_bot"), multiplayerMatch),
    ).toEqual(["Player: player-a-0f3c9e2d", "Victim: a bot", sameTickRepeatNoteText]);
    expect(
      describeMarkerEventWithoutTime(requireMultiplayerEvent("loot"), multiplayerMatch),
    ).toEqual(["Player: player-a-0f3c9e2d"]);
  });

  it("throws for an event from another match", () => {
    expect(() =>
      describeMarkerEventWithoutTime(requireMultiplayerEvent("loot"), quietMatch),
    ).toThrow('was given an event from match "multiplayer"');
  });
});

describe("timeline and actor list text", () => {
  it("formats elapsed time as m:ss, rounding down to the whole second", () => {
    expect(formatElapsedClock(0)).toBe("0:00");
    expect(formatElapsedClock(9.99)).toBe("0:09");
    expect(formatElapsedClock(65)).toBe("1:05");
    expect(formatElapsedClock(729)).toBe("12:09");
    expect(formatTimelineClock(65.5, 729)).toBe("1:05 / 12:09");
  });

  it("throws for a negative or non-finite elapsed time", () => {
    expect(() => formatElapsedClock(-1)).toThrow("Cannot show -1 s as m:ss");
    expect(() => formatElapsedClock(Number.NaN)).toThrow("Cannot show NaN s as m:ss");
  });

  it("shortens long actor keys to their first 8 characters and keeps short ones", () => {
    expect(shortActorKey("f4e072fa-1b2c-4d5e-8f90-123456789abc")).toBe("f4e072fa");
    expect(shortActorKey("1432")).toBe("1432");
  });
});
