import { z } from "zod";
import type { ActorTrack, DayFile, EventConfig, EventRule, Manifest, MapConfig } from "./types";

// Validates the pipeline's output once, on load (enforcement/data-contract.md). Every schema is
// strict: a field the contract does not define fails loudly instead of being silently dropped.

export class DataContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataContractError";
  }
}

const relativePathSchema = z
  .string()
  .min(1)
  .refine((path) => !path.startsWith("/"), "must be a relative path with no leading slash");
const dayUtcSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a YYYY-MM-DD date");
const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be a #rrggbb color");
const nonNegativeIntegerSchema = z.number().int().nonnegative();

const mapEntrySchema = z
  .object({
    mapId: z.string().min(1),
    imageFile: relativePathSchema,
    imageWidthPixels: z.number().int().positive(),
    imageHeightPixels: z.number().int().positive(),
    worldScale: z.number().finite().positive(),
    worldOriginX: z.number().finite(),
    worldOriginZ: z.number().finite(),
  })
  .strict();

const eventRuleSchema = z
  .object({
    category: z.string().min(1),
    other_party: z.enum(["player", "bot", "none", "unknown"]),
    marker: z.string().min(1).nullable(),
  })
  .strict();

const markerStyleSchema = z
  .object({
    label: z.string().min(1),
    shape: z.enum(["circle", "square", "triangle", "diamond"]),
    fill: hexColorSchema,
    cross: z.string().regex(/^(#[0-9a-fA-F]{6})?$/, 'must be a #rrggbb color, or "" for no cross'),
    outline: z.enum(["solid", "dashed"]),
  })
  .strict();

const eventConfigSchema = z
  .object({
    player: z.record(eventRuleSchema),
    bot: z.record(eventRuleSchema),
    markers: z.record(markerStyleSchema),
  })
  .strict();

const matchSummarySchema = z
  .object({
    matchId: z.string().min(1),
    mapId: z.string().min(1),
    dayUtc: dayUtcSchema,
    startTimestampSeconds: nonNegativeIntegerSchema,
    // The build rejects a match whose rows all share one second (length 0); mirror it here.
    durationSeconds: z
      .number()
      .int()
      .positive("must be above 0 (a match whose rows all share one second has broken timestamps)"),
    playerCount: nonNegativeIntegerSchema,
    botCount: nonNegativeIntegerSchema,
    eventCountsByMarker: z.record(nonNegativeIntegerSchema),
    dayFile: relativePathSchema,
  })
  .strict();

const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAtUtc: z.string().min(1),
    maps: z.array(mapEntrySchema),
    eventConfig: eventConfigSchema,
    matches: z.array(matchSummarySchema),
  })
  .strict()
  .superRefine((manifest, context) => {
    const markerKeys = new Set(Object.keys(manifest.eventConfig.markers));
    for (const side of ["player", "bot"] as const) {
      for (const [eventCode, rule] of Object.entries(manifest.eventConfig[side])) {
        if (rule.marker !== null && !markerKeys.has(rule.marker)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["eventConfig", side, eventCode, "marker"],
            message: `marker "${rule.marker}" is not defined in eventConfig.markers`,
          });
        }
      }
    }
    const mapIds = new Set(manifest.maps.map((mapEntry) => mapEntry.mapId));
    manifest.matches.forEach((match, matchIndex) => {
      if (!mapIds.has(match.mapId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["matches", matchIndex, "mapId"],
          message: `map "${match.mapId}" has no entry in maps`,
        });
      }
    });
  });

const parallelArrayKeys = ["worldZ", "timestampSeconds", "eventCodes", "isSameTickRepeat"] as const;

const actorTrackSchema = z
  .object({
    actorKey: z.string().min(1),
    userId: z.string().min(1),
    actorType: z.enum(["human", "human_misid", "bot"]),
    worldX: z.array(z.number().finite()),
    worldZ: z.array(z.number().finite()),
    timestampSeconds: z.array(nonNegativeIntegerSchema),
    eventCodes: z.array(z.string().min(1)),
    isSameTickRepeat: z.array(z.boolean()),
  })
  .strict()
  .superRefine((actor, context) => {
    for (const arrayKey of parallelArrayKeys) {
      if (actor[arrayKey].length !== actor.worldX.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [arrayKey],
          message:
            `actor "${actor.actorKey}" has ${actor[arrayKey].length} ${arrayKey} values ` +
            `but ${actor.worldX.length} worldX values (the arrays must be parallel)`,
        });
      }
    }
  });

const dayFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    mapId: z.string().min(1),
    dayUtc: dayUtcSchema,
    matches: z.array(
      z.object({ matchId: z.string().min(1), actors: z.array(actorTrackSchema) }).strict(),
    ),
  })
  .strict();

function describeIssues(sourceName: string, issues: readonly z.ZodIssue[]): string {
  const problemLines = issues.map((issue) => {
    const fieldPath = issue.path.length > 0 ? issue.path.join(".") : "(top level)";
    return `  - ${fieldPath}: ${issue.message}`;
  });
  return `${sourceName} does not match the data contract:\n${problemLines.join("\n")}`;
}

function toEventRules(
  rulesByEventCode: Record<string, z.infer<typeof eventRuleSchema>>,
): Record<string, EventRule> {
  return Object.fromEntries(
    Object.entries(rulesByEventCode).map(([eventCode, rule]) => [
      eventCode,
      { category: rule.category, otherParty: rule.other_party, marker: rule.marker },
    ]),
  );
}

export function parseManifest(json: unknown, dataBaseUrl: string): Manifest {
  if (!dataBaseUrl.endsWith("/")) {
    throw new DataContractError(
      `The data base URL "${dataBaseUrl}" must end with "/" so file paths can be appended to it`,
    );
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) {
    throw new DataContractError(describeIssues("manifest.json", parsed.error.issues));
  }
  const maps: MapConfig[] = parsed.data.maps.map((mapEntry) => ({
    mapId: mapEntry.mapId,
    imageUrl: dataBaseUrl + mapEntry.imageFile,
    imageWidthPixels: mapEntry.imageWidthPixels,
    imageHeightPixels: mapEntry.imageHeightPixels,
    worldScale: mapEntry.worldScale,
    worldOriginX: mapEntry.worldOriginX,
    worldOriginZ: mapEntry.worldOriginZ,
  }));
  const eventConfig: EventConfig = {
    player: toEventRules(parsed.data.eventConfig.player),
    bot: toEventRules(parsed.data.eventConfig.bot),
    markers: parsed.data.eventConfig.markers,
  };
  return {
    schemaVersion: parsed.data.schemaVersion,
    generatedAtUtc: parsed.data.generatedAtUtc,
    maps,
    eventConfig,
    matches: parsed.data.matches,
  };
}

export function parseDayFile(json: unknown): DayFile {
  const parsed = dayFileSchema.safeParse(json);
  if (!parsed.success) {
    throw new DataContractError(describeIssues("Day file", parsed.error.issues));
  }
  return {
    schemaVersion: parsed.data.schemaVersion,
    mapId: parsed.data.mapId,
    dayUtc: parsed.data.dayUtc,
    matches: parsed.data.matches.map((match) => ({
      matchId: match.matchId,
      actors: match.actors.map((actor): ActorTrack => ({
        ...actor,
        isPlayer: actor.actorType !== "bot",
      })),
    })),
  };
}
