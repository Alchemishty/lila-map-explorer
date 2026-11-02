import { describe, expect, it } from "vitest";
import { DataContractError } from "./contract";
import { assignActorColors } from "./actorColors";
import type { ActorTrack, ActorType } from "./types";

function buildTrack(
  actorKey: string,
  actorType: ActorType,
  timestampSeconds: readonly number[],
): ActorTrack {
  return {
    actorKey,
    userId: actorKey,
    actorType,
    isPlayer: actorType !== "bot",
    worldX: timestampSeconds.map(() => 0),
    worldZ: timestampSeconds.map(() => 0),
    timestampSeconds,
    eventCodes: timestampSeconds.map(() => (actorType === "bot" ? "BotPosition" : "Position")),
    isSameTickRepeat: timestampSeconds.map(() => false),
  };
}

describe("assignActorColors", () => {
  it("gives players the palette in order of their first timestamp, whatever the track order", () => {
    const actorColorsByKey = assignActorColors([
      buildTrack("player-second", "human", [1010, 1020]),
      buildTrack("player-first", "human_misid", [1000, 1030]),
      buildTrack("player-third", "human", [1015]),
    ]);
    expect(actorColorsByKey.get("player-first")).toEqual({ color: "#22d3ee", isDashed: false });
    expect(actorColorsByKey.get("player-second")).toEqual({ color: "#f472b6", isDashed: false });
    expect(actorColorsByKey.get("player-third")).toEqual({ color: "#a3e635", isDashed: false });
  });

  it("gives every bot the dashed grey trail and leaves the player order untouched", () => {
    const actorColorsByKey = assignActorColors([
      buildTrack("bot-early", "bot", [900]),
      buildTrack("player-only", "human", [1000]),
      buildTrack("bot-late", "bot", [2000]),
    ]);
    expect(actorColorsByKey.get("bot-early")).toEqual({ color: "#cbd5e1", isDashed: true });
    expect(actorColorsByKey.get("bot-late")).toEqual({ color: "#cbd5e1", isDashed: true });
    expect(actorColorsByKey.get("player-only")).toEqual({ color: "#22d3ee", isDashed: false });
    expect(actorColorsByKey.size).toBe(3);
  });

  it("cycles the six-color palette, so a 7th player gets the first color again", () => {
    const playerTracks = [0, 1, 2, 3, 4, 5, 6].map((i) =>
      buildTrack(`player-${i}`, "human", [1000 + i]),
    );
    const actorColorsByKey = assignActorColors(playerTracks);
    expect(playerTracks.map((track) => actorColorsByKey.get(track.actorKey)?.color)).toEqual([
      "#22d3ee",
      "#f472b6",
      "#a3e635",
      "#fb923c",
      "#818cf8",
      "#2dd4bf",
      "#22d3ee",
    ]);
  });

  it("orders players who start in the same second by actor key", () => {
    const actorColorsByKey = assignActorColors([
      buildTrack("player-b", "human", [1000]),
      buildTrack("player-a", "human", [1000]),
    ]);
    expect(actorColorsByKey.get("player-a")?.color).toBe("#22d3ee");
    expect(actorColorsByKey.get("player-b")?.color).toBe("#f472b6");
  });

  it("colors a bot with no rows without failing", () => {
    expect(assignActorColors([buildTrack("bot-empty", "bot", [])]).get("bot-empty")).toEqual({
      color: "#cbd5e1",
      isDashed: true,
    });
  });

  it("returns an empty map for no tracks", () => {
    expect(assignActorColors([]).size).toBe(0);
  });

  it("throws when a player has no rows, since its palette slot cannot be ordered", () => {
    expect(() => assignActorColors([buildTrack("player-empty", "human", [])])).toThrow(
      DataContractError,
    );
    expect(() => assignActorColors([buildTrack("player-empty", "human", [])])).toThrow(
      'Actor "player-empty" is a player with no rows, so it has no first timestamp to order its trail color by',
    );
  });

  it("throws when two tracks share an actor key", () => {
    expect(() =>
      assignActorColors([
        buildTrack("player-twin", "human", [1000]),
        buildTrack("player-twin", "human", [1001]),
      ]),
    ).toThrow('Actor key "player-twin" appears in more than one track');
  });
});
