// @repo-wide-fitness scope=schema — the statements are here, the tables they name are in
// packages/database, so the diff that renames one never touches this package.
import {
  calendarEventLink,
  calendarSyncFirmLimit,
  calendarSyncRule,
  firmEvent,
  firmEventParticipant,
  firmResource,
  firmResourceBooking,
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
  selectMatterEventDetailStatement,
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
import {
  FIRM_RESOURCE_BOOKING_TABLE,
  insertFirmResourceBookingStatement,
} from "../src/booking-statements.ts";
import {
  FIRM_EVENT_PARTICIPANT_TABLE,
  FIRM_EVENT_TABLE,
  insertFirmEventParticipantStatement,
  insertFirmEventStatement,
  selectFirmEventsStatement,
} from "../src/firm-event-statements.ts";
import {
  CALENDAR_EVENT_LINK_TABLE,
  insertCalendarEventLinkStatement,
} from "../src/link-statements.ts";
import {
  FIRM_RESOURCE_TABLE,
  insertFirmResourceStatement,
  selectFirmResourcesStatement,
} from "../src/resource-statements.ts";
import {
  CALENDAR_SYNC_FIRM_LIMIT_TABLE,
  CALENDAR_SYNC_RULE_TABLE,
  deleteSyncRulesForSubjectStatement,
  deleteSyncRulesStatement,
  insertSyncRuleStatement,
  selectSyncFirmLimitsStatement,
  selectSyncRulesStatement,
  upsertSyncFirmLimitStatement,
} from "../src/sync-rule-statements.ts";
import { visibleMatterPredicate } from "../src/visibility.ts";

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
  // The visible-matter predicate aliases the table it selects from, so a caller's own `matter`
  // cannot shadow it and neutralize the correlation (src/visibility.ts says why at length). The
  // alias is a name in the SQL and not a column in the schema, so this scan has to know it — the
  // alternative, letting the scan reject it, would push somebody toward removing the alias.
  "visible_matter",
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
const visibility = visibleMatterPredicate();
// The visible-matter predicate is composed into every SELECT over these two tables, so its own
// table and column are part of the vocabulary those statements legitimately name.
const VISIBILITY_IDENTIFIERS = ["matter", "system_key"] as const;
const USER_ID = "user_x" as never;

describe("schema name sync (calendar SQL pinned to @magna-carta/database)", () => {
  it("table name constants match the drizzle schema", () => {
    expect(getTableConfig(matterEvent).name).toBe(MATTER_EVENT_TABLE);
    expect(getTableConfig(matterEventType).name).toBe(MATTER_EVENT_TYPE_TABLE);
    expect(getTableConfig(matterEventParticipant).name).toBe(MATTER_EVENT_PARTICIPANT_TABLE);
    expect(getTableConfig(matterDeadline).name).toBe(MATTER_DEADLINE_TABLE);
    expect(getTableConfig(firmEvent).name).toBe(FIRM_EVENT_TABLE);
    expect(getTableConfig(firmEventParticipant).name).toBe(FIRM_EVENT_PARTICIPANT_TABLE);
    expect(getTableConfig(firmResource).name).toBe(FIRM_RESOURCE_TABLE);
    expect(getTableConfig(firmResourceBooking).name).toBe(FIRM_RESOURCE_BOOKING_TABLE);
    expect(getTableConfig(calendarEventLink).name).toBe(CALENDAR_EVENT_LINK_TABLE);
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
          conferenceUrl: null,
          courtReference: null,
          recurrenceRule: null,
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
            conferenceUrl: null,
            courtReference: null,
            recurrenceRule: null,
            status: "scheduled",
          },
          "t",
        ),
      ),
      sqlOf(cancelMatterEventStatement(stub, EVENT_ID, "t")),
      sqlOf(selectMatterEventStatement(stub, EVENT_ID, visibility)),
      sqlOf(selectMatterEventsStatement(stub, MATTER_ID, { limit: 10, visibility })),
      sqlOf(
        selectMatterEventsStatement(stub, MATTER_ID, {
          limit: 10,
          cursor: { sortKey: "2026-09-14", id: "matterEvent_y" },
          visibility,
        }),
      ),
      sqlOf(selectMatterEventDetailStatement(stub, EVENT_ID, visibility)),
    ].join("\n");
    expectOnlyKnownIdentifiers(
      sql,
      new Set([
        MATTER_EVENT_TABLE,
        ...columnsOf(matterEvent),
        ...VISIBILITY_IDENTIFIERS,
        // The display reads join the type catalog for its name, so that table and its columns are
        // part of the vocabulary those statements legitimately name.
        MATTER_EVENT_TYPE_TABLE,
        ...columnsOf(matterEventType),
        // The projection alias the joined name arrives under. Not a column anywhere, which is the
        // point: it exists only on the wire.
        "event_type_name",
      ]),
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
      sqlOf(selectMatterDeadlineStatement(stub, DEADLINE_ID, visibility)),
    ].join("\n");
    expectOnlyKnownIdentifiers(
      sql,
      new Set([MATTER_DEADLINE_TABLE, ...columnsOf(matterDeadline), ...VISIBILITY_IDENTIFIERS]),
      "deadline",
    );
  });

  it("every column the firm-scope SQL names exists in the schema", () => {
    const FIRM_EVENT_ID = "firmEvent_x" as never;
    const firmEventSql = [
      sqlOf(
        insertFirmEventStatement(stub, {
          id: FIRM_EVENT_ID,
          eventTypeId: null,
          title: "t",
          description: null,
          status: "scheduled",
          startsOn: "2026-09-10",
          startsAtTime: null,
          endsOn: null,
          endsAtTime: null,
          timeZone: "UTC",
          audience: "participants",
          locationId: null,
          locationText: null,
          conferenceUrl: null,
          recurrenceRule: null,
          recordedAt: "t",
          recordedBy: null,
          now: "t",
        }),
      ),
      sqlOf(
        selectFirmEventsStatement(stub, {
          fromDate: "2026-01-01",
          toDate: "2026-12-31",
          limit: 10,
        }),
      ),
    ].join("\n");
    expectOnlyKnownIdentifiers(
      firmEventSql,
      new Set([FIRM_EVENT_TABLE, ...columnsOf(firmEvent)]),
      "firm event",
    );

    const participantSql = sqlOf(
      insertFirmEventParticipantStatement(stub, {
        id: "firmEventParticipant_x" as never,
        firmEventId: FIRM_EVENT_ID,
        participantKind: "member",
        memberUserId: USER_ID,
        entityId: null,
        participantName: null,
        role: null,
        now: "t",
      }),
    );
    expectOnlyKnownIdentifiers(
      participantSql,
      new Set([FIRM_EVENT_PARTICIPANT_TABLE, ...columnsOf(firmEventParticipant)]),
      "firm event participant",
    );

    const resourceSql = [
      sqlOf(
        insertFirmResourceStatement(stub, {
          id: "firmResource_x" as never,
          name: "n",
          kind: "room",
          locationId: null,
          capacity: null,
          notes: null,
          now: "t",
        }),
      ),
      sqlOf(selectFirmResourcesStatement(stub, { limit: 10 })),
    ].join("\n");
    expectOnlyKnownIdentifiers(
      resourceSql,
      new Set([FIRM_RESOURCE_TABLE, ...columnsOf(firmResource)]),
      "resource",
    );

    const bookingSql = sqlOf(
      insertFirmResourceBookingStatement(stub, {
        id: "firmResourceBooking_x" as never,
        resourceId: "firmResource_x" as never,
        matterEventId: EVENT_ID,
        firmEventId: null,
        startsOn: "2026-09-10",
        startsAtTime: null,
        endsOn: null,
        endsAtTime: null,
        timeZone: "UTC",
        recordedAt: "t",
        recordedBy: null,
        now: "t",
      }),
    );
    expectOnlyKnownIdentifiers(
      bookingSql,
      new Set([FIRM_RESOURCE_BOOKING_TABLE, ...columnsOf(firmResourceBooking)]),
      "booking",
    );

    const linkSql = sqlOf(
      insertCalendarEventLinkStatement(stub, {
        id: "calendarEventLink_x" as never,
        from: { matterEventId: EVENT_ID },
        to: { matterEventId: "matterEvent_y" as never },
        kind: "continuance_of",
        note: null,
        recordedBy: null,
        now: "t",
      }),
    );
    expectOnlyKnownIdentifiers(
      linkSql,
      new Set([CALENDAR_EVENT_LINK_TABLE, ...columnsOf(calendarEventLink)]),
      "link",
    );
  });

  it("every column the calendar sync SQL names exists in the schema", () => {
    expect(getTableConfig(calendarSyncRule).name).toBe(CALENDAR_SYNC_RULE_TABLE);
    expect(getTableConfig(calendarSyncFirmLimit).name).toBe(CALENDAR_SYNC_FIRM_LIMIT_TABLE);
    const connectionId = "integrationConnection_x" as never;
    const ruleColumns = new Set([CALENDAR_SYNC_RULE_TABLE, ...columnsOf(calendarSyncRule)]);
    for (const statement of [
      selectSyncRulesStatement(stub, connectionId),
      deleteSyncRulesStatement(stub, connectionId),
      deleteSyncRulesForSubjectStatement(stub, "deadline"),
      insertSyncRuleStatement(
        stub,
        connectionId,
        { subject: "deadline", calendarRemoteId: "c", calendarName: "C", scope: "mine" },
        "t",
      ),
    ]) {
      expectOnlyKnownIdentifiers(sqlOf(statement), ruleColumns, "sync rule");
    }
    const limitColumns = new Set([
      CALENDAR_SYNC_FIRM_LIMIT_TABLE,
      ...columnsOf(calendarSyncFirmLimit),
      // The row an upsert proposes, as SQLite names it.
      "conflict",
      "do",
      "excluded",
    ]);
    for (const statement of [
      selectSyncFirmLimitsStatement(stub),
      upsertSyncFirmLimitStatement(
        stub,
        { subject: "deadline", mayLeave: true, detail: "full" },
        USER_ID,
        "t",
      ),
    ]) {
      expectOnlyKnownIdentifiers(sqlOf(statement), limitColumns, "sync firm limit");
    }
  });
});
