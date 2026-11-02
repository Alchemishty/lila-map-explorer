import { describe, expect, it } from "vitest";
import { DataContractError, parseDayFile, parseManifest } from "./contract";
import {
  buildDayFileJson,
  buildManifestJson,
  captureError,
  getFirstFixtureEntry,
  getFixtureActor,
} from "./contractTestFixtures";

const dataBaseUrl = "./data/";

describe("parseManifest", () => {
  it("parses the real data's shape and maps snake_case rules to camelCase", () => {
    const manifest = parseManifest(buildManifestJson(), dataBaseUrl);

    expect(manifest.maps[0]).toEqual({
      mapId: "GrandRift",
      imageUrl: "./data/minimaps/GrandRift.jpg",
      imageWidthPixels: 2160,
      imageHeightPixels: 2158,
      worldScale: 581,
      worldOriginX: -290,
      worldOriginZ: -290,
    });
    expect(manifest.eventConfig.player["Position"]).toEqual({
      category: "position",
      otherParty: "none",
      marker: null,
    });
    expect(manifest.eventConfig.bot["BotKill"]).toEqual({
      category: "bot_kill",
      otherParty: "unknown",
      marker: "bot_kill",
    });
    expect(manifest.eventConfig.markers["loot"]?.cross).toBe("");
    expect(manifest.matches[0]?.dayFile).toBe("days/GrandRift/2026-02-10.json");
    expect(manifest.matches[0]?.eventCountsByMarker).toEqual({ loot: 31, kill_bot: 5 });
  });

  it("rejects a match missing dayUtc and names the field path", () => {
    const manifestJson = buildManifestJson();
    delete getFirstFixtureEntry(manifestJson, "matches")["dayUtc"];

    const error = captureError(() => parseManifest(manifestJson, dataBaseUrl));
    expect(error).toBeInstanceOf(DataContractError);
    expect(error.message).toContain("matches.0.dayUtc");
  });

  it("rejects a dataBaseUrl without a trailing slash", () => {
    const error = captureError(() => parseManifest(buildManifestJson(), "./data"));
    expect(error).toBeInstanceOf(DataContractError);
    expect(error.message).toContain('"./data"');
  });

  it("rejects a field the contract does not define instead of dropping it", () => {
    const manifestJson = buildManifestJson();
    const firstMap = getFirstFixtureEntry(manifestJson, "maps");
    firstMap["imageScale"] = 2;

    const error = captureError(() => parseManifest(manifestJson, dataBaseUrl));
    expect(error).toBeInstanceOf(DataContractError);
    expect(error.message).toContain("maps.0");
    expect(error.message).toContain("imageScale");
  });

  it("rejects an image path with a leading slash", () => {
    const manifestJson = buildManifestJson();
    const firstMap = getFirstFixtureEntry(manifestJson, "maps");
    firstMap["imageFile"] = "/minimaps/GrandRift.jpg";

    const error = captureError(() => parseManifest(manifestJson, dataBaseUrl));
    expect(error.message).toContain("maps.0.imageFile");
  });

  it("rejects a rule whose marker key is not in markers", () => {
    const manifestJson = buildManifestJson();
    const eventConfig = manifestJson["eventConfig"] as Record<string, Record<string, unknown>>;
    eventConfig["player"] = {
      ...eventConfig["player"],
      Kill: { category: "kill", other_party: "player", marker: "kill_player" },
    };

    const error = captureError(() => parseManifest(manifestJson, dataBaseUrl));
    expect(error).toBeInstanceOf(DataContractError);
    expect(error.message).toContain("eventConfig.player.Kill.marker");
    expect(error.message).toContain('"kill_player"');
  });

  it("rejects a cross that is neither a #rrggbb color nor empty, in plain words", () => {
    const manifestJson = buildManifestJson();
    const eventConfig = manifestJson["eventConfig"] as Record<string, Record<string, unknown>>;
    eventConfig["markers"] = {
      ...eventConfig["markers"],
      loot: { label: "Loot", shape: "diamond", fill: "#facc15", cross: "red", outline: "solid" },
    };

    const error = captureError(() => parseManifest(manifestJson, dataBaseUrl));
    expect(error).toBeInstanceOf(DataContractError);
    expect(error.message).toContain("eventConfig.markers.loot.cross");
    expect(error.message).toContain('must be a #rrggbb color, or "" for no cross');
  });

  it("rejects a match whose map has no entry in maps", () => {
    const manifestJson = buildManifestJson();
    const firstMatch = getFirstFixtureEntry(manifestJson, "matches");
    firstMatch["mapId"] = "Lockdown";

    const error = captureError(() => parseManifest(manifestJson, dataBaseUrl));
    expect(error).toBeInstanceOf(DataContractError);
    expect(error.message).toContain("matches.0.mapId");
    expect(error.message).toContain('"Lockdown"');
  });

  it.each([
    {
      fieldPath: "schemaVersion",
      breakManifest: (manifestJson: Record<string, unknown>) => {
        manifestJson["schemaVersion"] = 2;
      },
      expectedProblem: "schemaVersion: Invalid literal value, expected 1",
    },
    {
      fieldPath: "matches.0.dayUtc",
      breakManifest: (manifestJson: Record<string, unknown>) => {
        const firstMatch = getFirstFixtureEntry(manifestJson, "matches");
        firstMatch["dayUtc"] = "10/02/2026";
      },
      expectedProblem: "matches.0.dayUtc: must be a YYYY-MM-DD date",
    },
    {
      fieldPath: "matches.0.durationSeconds",
      breakManifest: (manifestJson: Record<string, unknown>) => {
        const firstMatch = getFirstFixtureEntry(manifestJson, "matches");
        firstMatch["durationSeconds"] = 0;
      },
      expectedProblem:
        "matches.0.durationSeconds: must be above 0 (a match whose rows all share one second has broken timestamps)",
    },
    {
      fieldPath: "matches.0.dayFile",
      breakManifest: (manifestJson: Record<string, unknown>) => {
        const firstMatch = getFirstFixtureEntry(manifestJson, "matches");
        firstMatch["dayFile"] = "/days/GrandRift/2026-02-10.json";
      },
      expectedProblem: "matches.0.dayFile: must be a relative path with no leading slash",
    },
    {
      fieldPath: "eventConfig.markers.loot.fill",
      breakManifest: (manifestJson: Record<string, unknown>) => {
        const eventConfig = manifestJson["eventConfig"] as Record<string, Record<string, unknown>>;
        eventConfig["markers"] = {
          ...eventConfig["markers"],
          loot: { label: "Loot", shape: "diamond", fill: "#fc1", cross: "", outline: "solid" },
        };
      },
      expectedProblem: "eventConfig.markers.loot.fill: must be a #rrggbb color",
    },
  ])("rejects a bad $fieldPath in plain words", ({ breakManifest, expectedProblem }) => {
    const manifestJson = buildManifestJson();
    breakManifest(manifestJson);

    const error = captureError(() => parseManifest(manifestJson, dataBaseUrl));
    expect(error).toBeInstanceOf(DataContractError);
    expect(error.message).toContain(expectedProblem);
  });
});

describe("parseDayFile", () => {
  it("parses actors at full precision and derives isPlayer from actorType", () => {
    const dayFile = parseDayFile(buildDayFileJson());
    const firstMatch = dayFile.matches[0];
    if (firstMatch === undefined) throw new Error("parsed day file has no match");
    const actors = firstMatch.actors;

    expect(actors.map((actor) => [actor.actorType, actor.isPlayer])).toEqual([
      ["human", true],
      ["human_misid", true],
      ["bot", false],
    ]);
    expect(actors[0]?.worldX).toEqual([-301.4536743164062, 12.5]);
    expect(actors[0]?.eventCodes).toEqual(["Position", "Loot"]);
  });

  it("rejects parallel arrays of different lengths and names the actor key", () => {
    const dayFileJson = buildDayFileJson();
    getFixtureActor(dayFileJson, 1)["worldZ"] = [-355.55];

    const error = captureError(() => parseDayFile(dayFileJson));
    expect(error).toBeInstanceOf(DataContractError);
    expect(error.message).toContain('"1441"');
    expect(error.message).toContain("worldZ");
  });

  it("rejects an unknown actor type and names the field path", () => {
    const dayFileJson = buildDayFileJson();
    const firstActor = getFixtureActor(dayFileJson, 0);
    firstActor["actorType"] = "npc";

    const error = captureError(() => parseDayFile(dayFileJson));
    expect(error).toBeInstanceOf(DataContractError);
    expect(error.message).toContain("matches.0.actors.0.actorType");
  });
  it("rejects a field the day file contract does not define and names its path", () => {
    const dayFileJson = buildDayFileJson();
    const firstActor = getFixtureActor(dayFileJson, 0);
    firstActor["worldY"] = [12.0, 13.0];

    const error = captureError(() => parseDayFile(dayFileJson));
    expect(error).toBeInstanceOf(DataContractError);
    expect(error.message).toContain("matches.0.actors.0: Unrecognized key(s) in object: 'worldY'");
  });
});
