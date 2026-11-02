import { describe, expect, it } from "vitest";
import { lootCategory, orderLootFirst, type MapEvent } from "./events";

function buildEvent(eventCode: string, category: string, timestampSeconds: number): MapEvent {
  return {
    matchId: "match-1",
    actorKey: "player-a",
    actorType: "human",
    eventCode,
    category,
    markerKey: category,
    otherParty: "none",
    isPerformedByBot: false,
    position: { worldX: 1, worldZ: 2 },
    timestampSeconds,
    isSameTickRepeat: false,
  };
}

describe("orderLootFirst", () => {
  it("puts loot first and keeps the order within loot and within the rest", () => {
    const killEvent = buildEvent("BotKill", "kill", 10);
    const firstLoot = buildEvent("Loot", "loot", 11);
    const stormDeath = buildEvent("KilledByStorm", "storm_death", 12);
    const secondLoot = buildEvent("Loot", "loot", 13);
    const botKill = buildEvent("BotKill", "bot_kill", 14);
    const ordered = orderLootFirst(
      [killEvent, firstLoot, stormDeath, secondLoot, botKill],
      (mapEvent) => mapEvent,
    );
    expect(ordered).toEqual([firstLoot, secondLoot, killEvent, stormDeath, botKill]);
  });

  it("uses the loot category from config/event_types.json and leaves its input unchanged", () => {
    expect(lootCategory).toBe("loot");
    const events = [buildEvent("BotKill", "kill", 10), buildEvent("Loot", "loot", 11)];
    const eventsBefore = [...events];
    orderLootFirst(events, (mapEvent) => mapEvent);
    expect(events).toEqual(eventsBefore);
  });
});
