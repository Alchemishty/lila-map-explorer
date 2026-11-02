// Test-only fixtures for contract.test.ts and data/loader.test.ts; never imported by app code.

// Mirrors the real pipeline output, including cross: "", marker: null and other_party: "unknown".
export function buildManifestJson(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    generatedAtUtc: "2026-10-31T14:15:06.533163+00:00",
    maps: [
      {
        mapId: "GrandRift",
        imageFile: "minimaps/GrandRift.jpg",
        imageWidthPixels: 2160,
        imageHeightPixels: 2158,
        worldScale: 581.0,
        worldOriginX: -290.0,
        worldOriginZ: -290.0,
      },
    ],
    eventConfig: {
      player: {
        Position: { category: "position", other_party: "none", marker: null },
        BotKill: { category: "kill", other_party: "bot", marker: "kill_bot" },
        Loot: { category: "loot", other_party: "none", marker: "loot" },
      },
      bot: {
        BotPosition: { category: "position", other_party: "none", marker: null },
        BotKill: { category: "bot_kill", other_party: "unknown", marker: "bot_kill" },
      },
      markers: {
        kill_bot: {
          label: "Kill of a bot",
          shape: "square",
          fill: "#ef4444",
          cross: "#ffffff",
          outline: "solid",
        },
        loot: { label: "Loot", shape: "diamond", fill: "#facc15", cross: "", outline: "solid" },
        bot_kill: {
          label: "Bot made a kill (victim not recorded)",
          shape: "square",
          fill: "#ef4444",
          cross: "#ffffff",
          outline: "dashed",
        },
      },
    },
    matches: [
      {
        matchId: "0ef83054-bf85-443c-ac10-342a0bdd5371.nakama-0",
        mapId: "GrandRift",
        dayUtc: "2026-02-10",
        startTimestampSeconds: 1770748951,
        durationSeconds: 709,
        playerCount: 1,
        botCount: 2,
        eventCountsByMarker: { loot: 31, kill_bot: 5 },
        dayFile: "days/GrandRift/2026-02-10.json",
      },
    ],
  };
}

function buildActorJson(actorKey: string, actorType: string): Record<string, unknown> {
  return {
    actorKey,
    userId: actorKey,
    actorType,
    worldX: [-301.4536743164062, 12.5],
    worldZ: [-355.55, 40.25],
    timestampSeconds: [1770748951, 1770748971],
    eventCodes: ["Position", "Loot"],
    isSameTickRepeat: [false, false],
  };
}

export function buildDayFileJson(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    mapId: "GrandRift",
    dayUtc: "2026-02-10",
    matches: [
      {
        matchId: "0ef83054-bf85-443c-ac10-342a0bdd5371.nakama-0",
        actors: [
          buildActorJson("94d042cb-a0f2-45f3-bdca-42fab73cfef5", "human"),
          buildActorJson("1441", "human_misid"),
          buildActorJson("bot:1442", "bot"),
        ],
      },
    ],
  };
}

export function getFirstFixtureEntry(
  manifestJson: Record<string, unknown>,
  listName: "maps" | "matches",
): Record<string, unknown> {
  const firstEntry = (manifestJson[listName] as Record<string, unknown>[])[0];
  if (firstEntry === undefined) throw new Error(`fixture has no ${listName} entry`);
  return firstEntry;
}

export function getFixtureActor(
  dayFileJson: Record<string, unknown>,
  actorIndex: number,
): Record<string, unknown> {
  const matches = dayFileJson["matches"] as { actors: Record<string, unknown>[] }[];
  const actor = matches[0]?.actors[actorIndex];
  if (actor === undefined) throw new Error(`fixture has no actor at index ${actorIndex}`);
  return actor;
}

export function captureError(action: () => unknown): Error {
  try {
    action();
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw new Error(`expected an Error but caught ${String(error)}`);
  }
  throw new Error("expected the action to throw, but it returned normally");
}
