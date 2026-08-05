import {
  matterDeadline,
  matterEvent,
  matterEventParticipant,
  matterEventType,
} from "@magna-carta/database/per-firm-schema";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import {
  MATTER_DEADLINE_TABLE,
  closeMatterDeadlineStatement,
  insertMatterDeadlineStatement,
  satisfyMatterDeadlineStatement,
  selectMatterDeadlineStatement,
  updateMatterDeadlineStatement,
} from "../src/deadline-statements.ts";
import {
  MATTER_EVENT_PARTICIPANT_TABLE,
  MATTER_EVENT_TABLE,
  cancelMatterEventStatement,
  deleteMatterEventParticipantsStatement,
  insertMatterEventParticipantStatement,
  insertMatterEventStatement,
  selectMatterEventParticipantsStatement,
  selectMatterEventStatement,
  selectMatterEventsStatement,
  updateMatterEventStatement,
} from "../src/event-statements.ts";
import {
  MATTER_EVENT_TYPE_TABLE,
  deactivateMatterEventTypeStatement,
  insertMatterEventTypeStatement,
  selectMatterEventTypeIdByCodeStatement,
  selectMatterEventTypeIdByNameStatement,
  selectMatterEventTypeStatement,
  selectMatterEventTypesStatement,
  updateMatterEventTypeStatement,
} from "../src/event-type-statements.ts";

// Fitness function (the ledger pattern): the raw SQL in this package must track
// @magna-carta/database's schema. Renaming a table or a column there fails here, not in production.

function stubDatabase(): SqlDatabase {
  const statement = (sql: string): SqlStatement => ({
    sql,
    bind: () => statement(sql),
    run: () => Promise.resolve({ meta: { changes: 0 } }),
    all: <T>() => Promise.resolve({ results: [] as T[] }),
    first: () => Promise.resolve(null),
  });
  return { prepare: statement };
}

const sqlOf = (statement: SqlStatement): string => statement.sql ?? "";
const columnsOf = (table: Parameters<typeof getTableConfig>[0]): Set<string> =>
  new Set(getTableConfig(table).columns.map((column) => column.name));

const SQL_VOCABULARY = new Set([
  "insert",
  "into",
  "values",
  "select",
  "from",
  "where",
  "and",
  "or",
  "not",
  "null",
  "is",
  "in",
  "on",
  "join",
  "order",
  "by",
  "asc",
  "desc",
  "limit",
  "update",
  "set",
  "as",
  "count",
  "length",
  "case",
  "when",
  "then",
  "else",
  "end",
  "delete",
]);

const identifiers = (sql: string) =>
  sql.replace(/'(?:[^']|'')*'/g, " ").match(/\b[a-z_][a-z0-9_]*\b/g) ?? [];

function expectOnlyKnownIdentifiers(sql: string, allowed: ReadonlySet<string>, label: string) {
  for (const identifier of identifiers(sql)) {
    if (SQL_VOCABULARY.has(identifier)) continue;
    expect(allowed.has(identifier), `${label} SQL names "${identifier}"`).toBe(true);
  }
}

const stub = stubDatabase();
const EVENT_ID = "matterEvent_x" as never;
const EVENT_TYPE_ID = "matterEventType_x" as never;
const PARTICIPANT_ID = "matterEventParticipant_x" as never;
const DEADLINE_ID = "matterDeadline_x" as never;
const MATTER_ID = "matter_x" as never;
const USER_ID = "user_x" as never;

describe("schema name sync (calendar SQL pinned to @magna-carta/database)", () => {
  it("table name constants match the drizzle schema", () => {
    expect(getTableConfig(matterEvent).name).toBe(MATTER_EVENT_TABLE);
    expect(getTableConfig(matterEventType).name).toBe(MATTER_EVENT_TYPE_TABLE);
    expect(getTableConfig(matterEventParticipant).name).toBe(MATTER_EVENT_PARTICIPANT_TABLE);
    expect(getTableConfig(matterDeadline).name).toBe(MATTER_DEADLINE_TABLE);
  });

  it("every column the event SQL names exists in the schema", () => {
    const sql = [
      sqlOf(
        insertMatterEventStatement(stub, {
          id: EVENT_ID,
          matterId: MATTER_ID,
          eventTypeId: null,
          title: "t",
          description: null,
          status: "scheduled",
          startsOn: "2026-09-14",
          startsAtTime: null,
          endsOn: null,
          endsAtTime: null,
          timeZone: "UTC",
          locationText: null,
          courtReference: null,
          recordedAt: "t",
          recordedBy: null,
          now: "t",
        }),
      ),
      sqlOf(
        updateMatterEventStatement(
          stub,
          EVENT_ID,
          {
            eventTypeId: null,
            title: "t",
            description: null,
            startsOn: "2026-09-14",
            startsAtTime: null,
            endsOn: null,
            endsAtTime: null,
            timeZone: "UTC",
            locationText: null,
            courtReference: null,
            status: "scheduled",
          },
          "t",
        ),
      ),
      sqlOf(cancelMatterEventStatement(stub, EVENT_ID, "t")),
      sqlOf(selectMatterEventStatement(stub, EVENT_ID)),
      sqlOf(selectMatterEventsStatement(stub, MATTER_ID, { limit: 10 })),
      sqlOf(
        selectMatterEventsStatement(stub, MATTER_ID, {
          limit: 10,
          cursor: { sortKey: "2026-09-14", id: "matterEvent_y" },
        }),
      ),
    ].join("\n");
    expectOnlyKnownIdentifiers(
      sql,
      new Set([MATTER_EVENT_TABLE, ...columnsOf(matterEvent)]),
      "event",
    );
  });

  it("every column the participant SQL names exists in the schema", () => {
    const sql = [
      sqlOf(
        insertMatterEventParticipantStatement(stub, {
          id: PARTICIPANT_ID,
          eventId: EVENT_ID,
          participantKind: "member",
          memberUserId: USER_ID,
          entityId: null,
          participantName: null,
          role: null,
          now: "t",
        }),
      ),
      sqlOf(deleteMatterEventParticipantsStatement(stub, EVENT_ID)),
      sqlOf(selectMatterEventParticipantsStatement(stub, EVENT_ID)),
    ].join("\n");
    expectOnlyKnownIdentifiers(
      sql,
      new Set([MATTER_EVENT_PARTICIPANT_TABLE, ...columnsOf(matterEventParticipant)]),
      "participant",
    );
  });

  it("every column the event-type SQL names exists in the schema", () => {
    const sql = [
      sqlOf(
        insertMatterEventTypeStatement(stub, {
          id: EVENT_TYPE_ID,
          name: "n",
          code: "c",
          category: "litigation",
          createdAt: "t",
        }),
      ),
      sqlOf(
        updateMatterEventTypeStatement(
          stub,
          EVENT_TYPE_ID,
          { name: "n", code: "c", category: "firm" },
          "t",
        ),
      ),
      sqlOf(deactivateMatterEventTypeStatement(stub, EVENT_TYPE_ID, "t")),
      sqlOf(selectMatterEventTypeStatement(stub, EVENT_TYPE_ID)),
      sqlOf(selectMatterEventTypeIdByNameStatement(stub, "n")),
      sqlOf(selectMatterEventTypeIdByCodeStatement(stub, "c")),
      sqlOf(selectMatterEventTypesStatement(stub, true)),
    ].join("\n");
    expectOnlyKnownIdentifiers(
      sql,
      new Set([MATTER_EVENT_TYPE_TABLE, ...columnsOf(matterEventType)]),
      "event type",
    );
  });

  it("every column the deadline SQL names exists in the schema", () => {
    const sql = [
      sqlOf(
        insertMatterDeadlineStatement(stub, {
          id: DEADLINE_ID,
          matterId: MATTER_ID,
          title: "t",
          dueOn: "2026-09-07",
          dueAtTime: null,
          timeZone: "UTC",
          source: "member",
          authorityText: null,
          triggerEventId: null,
          priority: null,
          recordedAt: "t",
          recordedBy: null,
          now: "t",
        }),
      ),
      sqlOf(
        updateMatterDeadlineStatement(
          stub,
          DEADLINE_ID,
          {
            title: "t",
            dueOn: "2026-09-07",
            dueAtTime: null,
            timeZone: "UTC",
            authorityText: null,
            triggerEventId: null,
            priority: null,
          },
          "t",
        ),
      ),
      sqlOf(
        satisfyMatterDeadlineStatement(
          stub,
          DEADLINE_ID,
          {
            satisfiedAt: "t",
            satisfiedBy: USER_ID,
            satisfyingEventId: null,
            satisfactionNote: null,
          },
          "t",
        ),
      ),
      sqlOf(
        closeMatterDeadlineStatement(
          stub,
          DEADLINE_ID,
          { state: "vacated", stateReason: "r", supersededByDeadlineId: null },
          "t",
        ),
      ),
      sqlOf(selectMatterDeadlineStatement(stub, DEADLINE_ID)),
    ].join("\n");
    expectOnlyKnownIdentifiers(
      sql,
      new Set([MATTER_DEADLINE_TABLE, ...columnsOf(matterDeadline)]),
      "deadline",
    );
  });
});
