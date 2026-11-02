// Numerical tests for INSIGHTS.md. Run after `make data` from any directory.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const { build } = await import(
  pathToFileURL(join(projectRoot, "web/node_modules/esbuild/lib/main.js")).href
);
const temporaryDirectory = await mkdtemp(join(tmpdir(), "lila-insights-test-"));

try {
  const modulePaths = [
    "data/loader", "domain/events", "domain/heatmap", "domain/traffic", "domain/area",
  ];
  const bundledModules = await build({
    stdin: {
      contents: modulePaths.map((modulePath) =>
        `export * from ${JSON.stringify(join(projectRoot, "web/src", `${modulePath}.ts`))};`
      ).join("\n"),
      resolveDir: projectRoot,
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  const bundledModule = bundledModules.outputFiles[0];
  if (bundledModule === undefined) throw new Error("INSIGHTS.md tests: esbuild produced no module");
  const temporaryModulePath = join(temporaryDirectory, "domain.mjs");
  await writeFile(temporaryModulePath, bundledModule.contents);
  const {
    createDataLoader, deriveEvents, playerSideEvents, createHeatGrid,
    accumulateTrafficSeconds, readTrackRow, summarizeArea, cellIndexFor,
  } = await import(pathToFileURL(temporaryModulePath).href);

  const dataDirectory = join(projectRoot, "web/public/data/");
  const loader = createDataLoader(dataDirectory, async (filePath) =>
    JSON.parse(await readFile(filePath, "utf8"))
  );
  const manifest = await loader.loadManifest();
  const report = await readFile(join(projectRoot, "INSIGHTS.md"), "utf8");
  const statisticsByMapId = new Map();
  let stationaryDeathSessionCount = 0;
  let stationaryDeathSeconds = 0;
  assert.equal(manifest.matches.length, 796, "INSIGHTS.md: dataset match count changed");
  assert.equal(manifest.matches.reduce((total, match) => total + match.playerCount, 0), 798);

  function assertNear(actualValue, expectedValue, description) {
    assert.ok(Math.abs(actualValue - expectedValue) < 0.000001,
      `${description}: expected ${expectedValue}, received ${actualValue}`);
  }

  function secondsInsideArea(trafficGrid, area) {
    for (const boundary of [area.minWorldX, area.maxWorldX]) {
      assert.equal((boundary - trafficGrid.worldOriginX) % trafficGrid.cellWorldSize, 0);
    }
    for (const boundary of [area.minWorldZ, area.maxWorldZ]) {
      assert.equal((boundary - trafficGrid.worldOriginZ) % trafficGrid.cellWorldSize, 0);
    }
    return trafficGrid.values.reduce((totalSeconds, cellSeconds, cellIndex) => {
      const columnIndex = cellIndex % trafficGrid.columnCount;
      const rowIndex = Math.floor(cellIndex / trafficGrid.columnCount);
      const cellWorldX = trafficGrid.worldOriginX + (columnIndex + 0.5) * trafficGrid.cellWorldSize;
      const cellWorldZ = trafficGrid.worldOriginZ + (rowIndex + 0.5) * trafficGrid.cellWorldSize;
      const isInside = cellWorldX >= area.minWorldX && cellWorldX < area.maxWorldX &&
        cellWorldZ >= area.minWorldZ && cellWorldZ < area.maxWorldZ;
      return totalSeconds + (isInside ? cellSeconds : 0);
    }, 0);
  }

  for (const mapConfig of manifest.maps) {
    const matches = manifest.matches.filter((match) => match.mapId === mapConfig.mapId);
    const dayFiles = await Promise.all([...new Set(matches.map((match) => match.dayFile))]
      .map((dayFile) => loader.loadDayFile(dayFile)));
    const tracksByMatch = new Map(dayFiles.flatMap((dayFile) =>
      dayFile.matches.map((match) => [match.matchId, match.actors])));
    const tracks = [...tracksByMatch.values()].flat().filter((track) => track.isPlayer);
    const events = [...tracksByMatch].flatMap(([matchId, matchTracks]) =>
      playerSideEvents(deriveEvents(matchTracks, matchId, manifest.eventConfig)));
    const trafficGrid = accumulateTrafficSeconds(createHeatGrid(mapConfig), tracks, manifest.eventConfig);
    const trafficSeconds = trafficGrid.values.reduce((total, seconds) => total + seconds, 0);
    const lootEvents = events.filter((event) => event.category === "loot").length;
    const ratesByActorKey = new Map();
    let independentTrafficSeconds = 0;

    for (const track of tracks) {
      const rows = track.eventCodes.map((eventCode, rowIndex) =>
        readTrackRow(track, rowIndex, `INSIGHTS.md: ${mapConfig.mapId}, ${track.actorKey}`));
      const deathRows = rows.filter((row) =>
        ["Killed", "BotKilled", "KilledByStorm"].includes(row.eventCode));
      const deathSeconds = Math.min(...deathRows.map((row) => row.timestampSeconds)); // Infinity: no death.
      const positions = rows.filter((row) =>
        row.eventCode === "Position" && row.timestampSeconds <= deathSeconds);
      const firstPosition = positions.at(0);
      const lastPosition = positions.at(-1);
      // The first death row in time; undefined is valid for a track without a death.
      const firstDeath = deathRows.find((row) => row.timestampSeconds === deathSeconds);
      // Stationary time: a later first death at exactly the last sample's world X and Z.
      const stationarySeconds = firstDeath !== undefined && lastPosition !== undefined &&
        firstDeath.position.worldX === lastPosition.position.worldX &&
        firstDeath.position.worldZ === lastPosition.position.worldZ
        ? firstDeath.timestampSeconds - lastPosition.timestampSeconds : 0;
      if (stationarySeconds > 0) {
        stationaryDeathSessionCount += 1;
        stationaryDeathSeconds += stationarySeconds;
      }
      // Zero position samples is valid and contributes no interval time.
      const sessionSeconds = firstPosition === undefined || lastPosition === undefined
        ? 0 : lastPosition.timestampSeconds - firstPosition.timestampSeconds + stationarySeconds;
      independentTrafficSeconds += sessionSeconds;
      if (track.actorType === "human_misid") continue; // Anonymous sessions cannot be matched across maps.
      // An absent entry is valid: this is the first session for this identified player on this map.
      const previous = ratesByActorKey.get(track.actorKey) ?? { lootEvents: 0, trafficSeconds: 0 };
      ratesByActorKey.set(track.actorKey, {
        lootEvents: previous.lootEvents + rows.filter((row) => row.eventCode === "Loot").length,
        trafficSeconds: previous.trafficSeconds + sessionSeconds,
      });
    }
    assertNear(trafficSeconds, independentTrafficSeconds, `${mapConfig.mapId}: traffic conservation`);
    const manifestLootEvents = matches.reduce((total, match) =>
      total + (match.eventCountsByMarker.loot ?? 0), 0); // No loot in a match is valid.
    assert.equal(lootEvents, manifestLootEvents, `${mapConfig.mapId}: loot reconciles with manifest`);
    statisticsByMapId.set(mapConfig.mapId, {
      mapConfig, tracks, events, trafficGrid, trafficSeconds, lootEvents, ratesByActorKey, tracksByMatch,
    });
  }

  function requireStatistics(mapId) {
    const statistics = statisticsByMapId.get(mapId);
    if (statistics === undefined) throw new Error(`INSIGHTS.md: missing map ${mapId}`);
    return statistics;
  }

  const ambrose = requireStatistics("AmbroseValley");
  const grand = requireStatistics("GrandRift");
  const lockdown = requireStatistics("Lockdown");
  for (const [statistics, sessions, lootEvents, trafficSeconds] of [
    [ambrose, 568, 9902, 222504], [grand, 59, 880, 22887], [lockdown, 171, 2047, 70276],
  ]) {
    assert.equal(statistics.tracks.length, sessions);
    assert.equal(statistics.lootEvents, lootEvents);
    assertNear(statistics.trafficSeconds, trafficSeconds, "INSIGHTS.md: map player seconds");
  }
  // Stationary death: before it, the same data gave 221602 + 22780 + 70010 player seconds, without these tails.
  assert.equal(stationaryDeathSessionCount, 43, "stationary death: sessions gaining stationary time before death");
  assert.equal(stationaryDeathSeconds, 1275, "stationary death: stationary seconds before matching deaths");
  assertNear(ambrose.trafficSeconds + grand.trafficSeconds + lockdown.trafficSeconds,
    221602 + 22780 + 70010 + stationaryDeathSeconds, "stationary death: Traffic increase equals the added seconds");

  // Stationary-death regression: the storm-death session from player_data/February_10 stood still for 454 s.
  const stormDeathMatchId = "2e235c1a-bbb3-445e-b2fc-eaa34d8fd9e7.nakama-0";
  const stormDeathTrack = ambrose.tracksByMatch.get(stormDeathMatchId)
    ?.find((track) => track.actorKey === "f3cf6ebd-6ac0-4a78-ad6d-7486010249b8");
  if (stormDeathTrack === undefined) throw new Error(`stationary death: storm-death session missing from ${stormDeathMatchId}`);
  const stormDeathRowIndex = stormDeathTrack.eventCodes.indexOf("KilledByStorm");
  assert.equal(stormDeathTrack.timestampSeconds[stormDeathRowIndex], 1770693476);
  const tracksWithoutDeath = [{ ...stormDeathTrack, ...Object.fromEntries(
    ["eventCodes", "timestampSeconds", "worldX", "worldZ", "isSameTickRepeat"].map((arrayName) =>
      [arrayName, stormDeathTrack[arrayName].filter((_, rowIndex) => rowIndex !== stormDeathRowIndex)])) }];
  const gridWithDeath = accumulateTrafficSeconds(createHeatGrid(ambrose.mapConfig), [stormDeathTrack], manifest.eventConfig);
  const gridWithoutDeath = accumulateTrafficSeconds(createHeatGrid(ambrose.mapConfig), tracksWithoutDeath, manifest.eventConfig);
  const deathCellIndex = cellIndexFor(gridWithDeath, readTrackRow(stormDeathTrack, stormDeathRowIndex, "stationary death").position);
  const changedCellIndexes = Array.from(gridWithDeath.values).flatMap((cellSeconds, cellIndex) =>
    cellSeconds === gridWithoutDeath.values[cellIndex] ? [] : [cellIndex]);
  assert.deepEqual(changedCellIndexes, [deathCellIndex], "stationary death: only the death cell gains time");
  assert.equal(gridWithDeath.values[deathCellIndex] - gridWithoutDeath.values[deathCellIndex], 454);

  // Event waypoints: loot and kill rows between position samples are Traffic waypoints. They move time between
  // cells but never change a session's total, so only these area seconds changed.
  const southernArea = { minWorldX: -70, maxWorldX: 30, minWorldZ: -373, maxWorldZ: -273 };
  const centralArea = { minWorldX: -70, maxWorldX: 30, minWorldZ: -73, maxWorldZ: 27 };
  const corridorArea = { minWorldX: -90, maxWorldX: 10, minWorldZ: -90, maxWorldZ: 110 };
  const southern = summarizeArea(southernArea, ambrose.events, ambrose.tracksByMatch);
  const central = summarizeArea(centralArea, ambrose.events, ambrose.tracksByMatch);
  assert.equal(southern.countsByMarker.loot, 1102);
  assert.equal(southern.countsByMarker.death_by_bot, 3);
  assert.equal(central.countsByMarker.loot, 753);
  assert.equal(central.countsByMarker.death_by_bot, 43);
  assertNear(secondsInsideArea(ambrose.trafficGrid, southernArea), 14440.91742878247, "Southern seconds");
  assertNear(secondsInsideArea(ambrose.trafficGrid, centralArea), 14662.904965972939, "Central seconds");
  const corridor = summarizeArea(corridorArea, grand.events, grand.tracksByMatch);
  assert.equal(corridor.countsByMarker.death_by_bot, 16);
  assert.equal(corridor.countsByMarker.death_by_player, 1);
  assert.equal(corridor.matchIdsPassingThrough.length, 45);
  assert.equal(grand.events.filter((event) => event.category === "combat_death").length, 25);
  assertNear(secondsInsideArea(grand.trafficGrid, corridorArea), 6879.676820229383, "Corridor seconds");

  const lockdownRate = lockdown.lootEvents / lockdown.trafficSeconds * 3600;
  assertNear(lockdownRate, 104.86083442427018, "Lockdown loot per player-hour");
  assert.equal((100 * (1 - lockdownRate / (ambrose.lootEvents / ambrose.trafficSeconds * 3600))).toFixed(1), "34.5");
  assert.equal((100 * (1 - lockdownRate / (grand.lootEvents / grand.trafficSeconds * 3600))).toFixed(1), "24.2");
  const sharedPlayers = [...lockdown.ratesByActorKey].filter(([actorKey, statistics]) => {
    const other = ambrose.ratesByActorKey.get(actorKey);
    return statistics.trafficSeconds > 0 && other !== undefined && other.trafficSeconds > 0;
  });
  assert.equal(sharedPlayers.length, 55);
  assert.equal(sharedPlayers.filter(([actorKey, statistics]) => {
    const other = ambrose.ratesByActorKey.get(actorKey);
    if (other === undefined) throw new Error(`INSIGHTS.md: missing shared actor ${actorKey}`);
    return statistics.lootEvents / statistics.trafficSeconds < other.lootEvents / other.trafficSeconds;
  }).length, 41);
  for (const requiredText of ["46.3%", "14.1 times", "68%", "30.1%", "76.3%", "34.5%", "24.2%", "74.5%"])
    assert.ok(report.includes(requiredText), `INSIGHTS.md: missing checked figure ${requiredText}`);
  for (const tableRow of [
    "| Recorded player time | 4.01 player-hours | 4.07 player-hours |",
    "| Loot events | 1,102 | 753 |",
    "| Deaths caused by bots | 3 | 43 |",
    "| Bot-caused deaths per player-hour | 0.75 | 10.56 |",
    "| Combat deaths | 17 | 8 |",
    "| Recorded player time | 1.91 player-hours | 4.45 player-hours |",
    "| Combat deaths per player-hour | 8.90 | 1.80 |",
    "| AmbroseValley | 568 | 9,902 | 61.81 | 160.2 |",
    "| GrandRift | 59 | 880 | 6.36 | 138.4 |",
    "| Lockdown | 171 | 2,047 | 19.52 | 104.9 |",
  ]) assert.ok(report.includes(tableRow), `INSIGHTS.md: checked table row changed: ${tableRow}`);
  for (const label of ["What caught my eye", "Data", "What to try", "What to measure", "Why a level designer should care"])
    assert.equal(report.split(`**${label}**`).length - 1, 3, `INSIGHTS.md: expected three ${label} sections`);
  console.log("PASS: INSIGHTS.md numerical assertions, traffic conservation, manifest reconciliation and required sections.");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
