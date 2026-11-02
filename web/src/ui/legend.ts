import type { EventConfig, EventRule, MarkerStyle } from "../domain/types";

// The marker legend. Entries and labels come from the event config (docs/domain.md: the marker
// mapping lives in config, not in code).

export type LegendInclude = "player" | "all";

export interface LegendEntry {
  readonly markerKey: string;
  readonly style: MarkerStyle;
}

function appendRuleMarkers(
  entries: LegendEntry[],
  rulesByEventCode: Readonly<Record<string, EventRule>>,
  sideName: "player" | "bot",
  eventConfig: EventConfig,
): void {
  for (const [eventCode, eventRule] of Object.entries(rulesByEventCode)) {
    const markerKey = eventRule.marker;
    if (markerKey === null || entries.some((entry) => entry.markerKey === markerKey)) {
      continue; // valid path: position rules have no marker, and each marker is listed once
    }
    const style = Object.hasOwn(eventConfig.markers, markerKey)
      ? eventConfig.markers[markerKey]
      : undefined;
    if (style === undefined) {
      throw new Error(
        `Marker "${markerKey}" (used by the ${sideName} rule for "${eventCode}") has no style in ` +
          "eventConfig (manifest.json)",
      );
    }
    entries.push({ markerKey, style });
  }
}

/**
 * The markers the player rules use, in config order, then for "all" the markers only the bot
 * rules use. With today's config that is 6 player-side markers, plus 2 bot-event markers.
 */
export function legendEntries(eventConfig: EventConfig, include: LegendInclude): LegendEntry[] {
  const entries: LegendEntry[] = [];
  appendRuleMarkers(entries, eventConfig.player, "player", eventConfig);
  if (include === "all") {
    appendRuleMarkers(entries, eventConfig.bot, "bot", eventConfig);
  }
  return entries;
}
