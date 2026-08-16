// @repo-wide-fitness scope=schema — the statements are here, the tables they name are in
// packages/database, so the diff that renames one never touches this package.
import { aiSearchInstance } from "@magna-carta/database/control-plane-schema";
import {
  aiSearchDisclosureAcknowledgement,
  aiSearchFeedObject,
  aiSearchUsageMeter,
  matter,
} from "@magna-carta/database/per-firm-schema";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import {
  AI_SEARCH_INSTANCE_TABLE,
  claimInstanceProvisioningStatement,
  markInstanceAbsentStatement,
  markInstanceReadyStatement,
  markInstanceTearingDownStatement,
  readInstanceForFirm,
  readReadyInstances,
} from "../src/natural-language-instance-statements.ts";
import {
  AI_SEARCH_DISCLOSURE_ACKNOWLEDGEMENT_TABLE,
  AI_SEARCH_FEED_OBJECT_TABLE,
  AI_SEARCH_USAGE_METER_TABLE,
  countFeedObjectsPendingSince,
  enumerateFeedObjects,
  markFeedObjectRemovedStatement,
  MATTER_TABLE,
  readDisclosureAcknowledgement,
  readExcludedMatterIds,
  readFeedObjectsForDeletion,
  readMatterNaturalLanguageExcluded,
  readUsageMeterTotals,
  recordDisclosureAcknowledgementStatement,
  recordFeedObjectStatement,
  setMatterNaturalLanguageExclusionStatement,
  usageMeterCommitStatements,
} from "../src/natural-language-statements.ts";

// Fitness function (the ledger pattern, twin of the one in packages/matters): every identifier the
// raw SQL in this package names must exist in @magna-carta/database's schema. Renaming a table or a
// column there fails HERE, at build time, rather than on a firm's database at run time.

const collected: string[] = [];

function stubDatabase(): SqlDatabase {
  const statement = (sql: string): SqlStatement => {
    collected.push(sql);
    return {
      sql,
      bind: () => statement(sql),
      run: () => Promise.resolve({ meta: { changes: 0 } }),
      all: <T>() => Promise.resolve({ results: [] as T[] }),
      first: () => Promise.resolve(null),
    };
  };
  return { prepare: statement };
}

const columnsOf = (table: Parameters<typeof getTableConfig>[0]): Set<string> =>
  new Set(getTableConfig(table).columns.map((column) => column.name));

// SQL keywords and literals the scan is not asking about — it is asking about table and column
// names. String literals are stripped first so a bucketed value cannot look like a column.
const SQL_WORDS = new Set([
  "select",
  "insert",
  "into",
  "values",
  "update",
  "set",
  "from",
  "where",
  "and",
  "or",
  "not",
  "null",
  "is",
  "on",
  "conflict",
  "do",
  "nothing",
  "excluded",
  "order",
  "by",
  "limit",
  "count",
  "sum",
  "coalesce",
  "max",
  "as",
  "asc",
  "desc",
]);

const identifiers = (sql: string) =>
  sql.replace(/'(?:[^']|'')*'/g, " ").match(/\b[a-z_][a-z0-9_]*\b/g) ?? [];

describe("schema name sync (natural-language search SQL pinned to @magna-carta/database)", () => {
  it("table name constants match the drizzle schemas", () => {
    expect(getTableConfig(aiSearchFeedObject).name).toBe(AI_SEARCH_FEED_OBJECT_TABLE);
    expect(getTableConfig(aiSearchUsageMeter).name).toBe(AI_SEARCH_USAGE_METER_TABLE);
    expect(getTableConfig(aiSearchDisclosureAcknowledgement).name).toBe(
      AI_SEARCH_DISCLOSURE_ACKNOWLEDGEMENT_TABLE,
    );
    expect(getTableConfig(matter).name).toBe(MATTER_TABLE);
    expect(getTableConfig(aiSearchInstance).name).toBe(AI_SEARCH_INSTANCE_TABLE);
  });

  it("the matter exclusion column exists in the schema", () => {
    // The one column this feature adds to a table it does not own. If it is renamed there, the feed
    // writer's gate silently stops finding it — which would mean an excluded matter starts being fed
    // again, so this assertion is worth more than its size.
    expect(columnsOf(matter).has("natural_language_index_excluded")).toBe(true);
  });

  it("every identifier the SQL names is a table or a column that exists", async () => {
    collected.length = 0;
    const database = stubDatabase();
    const now = "2026-08-16T12:00:00.000Z";
    const fileId = "file_x" as never;
    const matterId = "matter_x" as never;
    const userId = "usr_x" as never;
    const firmId = "firm_x" as never;

    recordFeedObjectStatement(database, {
      fileId,
      version: 1,
      matterId,
      objectKey: "ai-search/matter_x/file_x/1.md",
      byteCount: 1,
      fedAt: now,
    });
    markFeedObjectRemovedStatement(database, fileId, 1, now);
    await readFeedObjectsForDeletion(database, { kind: "document-version", fileId, version: 1 }, 1);
    await readFeedObjectsForDeletion(database, { kind: "matter", matterId }, 1);
    await readFeedObjectsForDeletion(database, { kind: "firm" }, 1);
    await enumerateFeedObjects(database, { kind: "document-version", fileId, version: 1 }, 1);
    await enumerateFeedObjects(database, { kind: "matter", matterId }, 1);
    await enumerateFeedObjects(database, { kind: "firm" }, 1);
    await countFeedObjectsPendingSince(database, null);
    await countFeedObjectsPendingSince(database, now);
    usageMeterCommitStatements(database, { day: "2026-08-16", semanticQueryCount: 1 });
    await readUsageMeterTotals(database);
    recordDisclosureAcknowledgementStatement(database, {
      disclosureVersion: 1,
      acknowledgedBy: userId,
      now,
    });
    await readDisclosureAcknowledgement(database);
    setMatterNaturalLanguageExclusionStatement(database, matterId, true, now);
    await readMatterNaturalLanguageExcluded(database, matterId);
    await readExcludedMatterIds(database, 1);
    claimInstanceProvisioningStatement(database, {
      firmId,
      instanceName: "mc-0",
      configurationGeneration: 1,
      now,
    });
    markInstanceReadyStatement(database, { firmId, instanceIdentifier: "x", now });
    markInstanceTearingDownStatement(database, firmId, now);
    markInstanceAbsentStatement(database, { firmId, teardownResponse: "{}", now });
    await readInstanceForFirm(database, firmId);
    await readReadyInstances(database, 1);
    await readReadyInstances(database, 1, firmId);

    expect(collected.length).toBeGreaterThan(20);

    // Result aliases the reads mint for themselves. Listed one by one rather than matched by a
    // pattern, so the scan stays fail-closed: an alias nobody declared reads as an unknown column.
    const RESULT_ALIASES = ["pending"];

    const known = new Set<string>([
      ...SQL_WORDS,
      ...RESULT_ALIASES,
      AI_SEARCH_FEED_OBJECT_TABLE,
      AI_SEARCH_USAGE_METER_TABLE,
      AI_SEARCH_DISCLOSURE_ACKNOWLEDGEMENT_TABLE,
      AI_SEARCH_INSTANCE_TABLE,
      MATTER_TABLE,
      ...columnsOf(aiSearchFeedObject),
      ...columnsOf(aiSearchUsageMeter),
      ...columnsOf(aiSearchDisclosureAcknowledgement),
      ...columnsOf(aiSearchInstance),
      ...columnsOf(matter),
    ]);

    for (const sql of collected) {
      for (const identifier of identifiers(sql)) {
        expect(known.has(identifier), `SQL names "${identifier}": ${sql}`).toBe(true);
      }
    }
  });
});
