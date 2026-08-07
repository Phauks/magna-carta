import { describe, expect, it } from "vitest";
import {
  visibleMatterPredicate,
  visibleMatterPredicateExcluding,
  VISIBLE_MATTER_MARKER,
} from "@magna-carta/calendar/visibility";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  selectNotificationFeedStatement,
  selectOwnNotificationStatement,
  selectUnreadNotificationCountStatement,
} from "../src/read-statements.ts";

// EVERY notification read composes the visible-matter predicate, in SQL, before the LIMIT — proved
// from one table-driven pass rather than by review, in the shape the calendar's source fitness test
// established. The failure this catches is silent: a read that forgot the predicate returns MORE
// than it should and nothing about the response looks wrong.

// A recording stand-in: captures the SQL text and its bindings without a database. That is enough,
// because the property under test is what the statement SAYS, not what it returns.
interface RecordedStatement {
  readonly sql: string;
  readonly bindings: readonly unknown[];
}

function recordingDatabase(recorded: RecordedStatement[]): SqlDatabase {
  return {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          recorded.push({ sql, bindings });
          return this as unknown as SqlStatement;
        },
      } as unknown as SqlStatement;
    },
  } as unknown as SqlDatabase;
}

// Every exported read, built the way a route builds it. Adding a read means adding a row here —
// which is the point: a read absent from this table is a read nobody proved composes the wall.
const READS: readonly {
  readonly name: string;
  readonly build: (
    database: SqlDatabase,
    visibility: ReturnType<typeof visibleMatterPredicate>,
  ) => void;
}[] = [
  {
    name: "the feed page",
    build: (database, visibility) =>
      void selectNotificationFeedStatement(
        database,
        { recipientUserId: "user_reader", visibility },
        { cursor: undefined, pageSize: 25 },
      ),
  },
  {
    name: "the feed page with a category filter and a cursor",
    build: (database, visibility) =>
      void selectNotificationFeedStatement(
        database,
        { recipientUserId: "user_reader", visibility, category: "trust", state: "unread" },
        {
          cursor: { createdAt: "2026-08-01T00:00:00.000Z", id: "notificationRecipient_x" },
          pageSize: 10,
        },
      ),
  },
  {
    name: "the unread count",
    build: (database, visibility) =>
      void selectUnreadNotificationCountStatement(database, {
        recipientUserId: "user_reader",
        visibility,
      }),
  },
  {
    name: "the single-row resolve behind mark-read and dismiss",
    build: (database, visibility) =>
      void selectOwnNotificationStatement(
        database,
        { recipientUserId: "user_reader", visibility },
        "notificationRecipient_target",
      ),
  },
];

describe("every notification read composes the wall", () => {
  for (const read of READS) {
    it(`${read.name} carries the visible-matter marker`, () => {
      const recorded: RecordedStatement[] = [];
      read.build(recordingDatabase(recorded), visibleMatterPredicate());
      expect(recorded).toHaveLength(1);
      expect(recorded[0]?.sql).toContain(VISIBLE_MATTER_MARKER);
    });

    it(`${read.name} scopes to the session's user and never to a path parameter`, () => {
      const recorded: RecordedStatement[] = [];
      read.build(recordingDatabase(recorded), visibleMatterPredicate());
      expect(recorded[0]?.sql).toContain("recipient_user_id = ?");
      expect(recorded[0]?.bindings[0]).toBe("user_reader");
    });

    it(`${read.name} composes the predicate BEFORE the LIMIT`, () => {
      // A post-filter would under-fill the page, make the cursor mean something different from page
      // to page, and turn the page size into an existence oracle for the rows it removed. Position
      // in the text is the observable proxy for that.
      const recorded: RecordedStatement[] = [];
      read.build(recordingDatabase(recorded), visibleMatterPredicate());
      const sql = recorded[0]?.sql ?? "";
      const limitAt = sql.indexOf("LIMIT");
      if (limitAt === -1) return; // the count has no LIMIT and needs none
      expect(sql.indexOf(VISIBLE_MATTER_MARKER)).toBeLessThan(limitAt);
    });

    it(`${read.name} carries a narrowed predicate's extra bindings`, () => {
      // The shape an information-barrier overlay takes when it is built. A read that composed the
      // fragment but dropped its bindings would fail at the database rather than leak — but it
      // would fail for every firm at once, which is worth catching here.
      const recorded: RecordedStatement[] = [];
      read.build(recordingDatabase(recorded), visibleMatterPredicateExcluding(["matter_hidden"]));
      expect(recorded[0]?.sql).toContain("NOT IN");
      expect(recorded[0]?.bindings).toContain("matter_hidden");
    });
  }

  it("lets a firm-scoped notification through the wall rather than filtering it out", () => {
    // A kind with no matter anchor is not behind the wall: there is no matter whose visibility
    // could decide it. Writing that arm once, here, is what keeps a firm-scoped kind from silently
    // vanishing the day somebody tightens the join.
    const recorded: RecordedStatement[] = [];
    selectUnreadNotificationCountStatement(recordingDatabase(recorded), {
      recipientUserId: "user_reader",
      visibility: visibleMatterPredicate(),
    });
    expect(recorded[0]?.sql).toContain("notification_event.matter_id IS NULL OR");
  });

  it("asks the unread count exactly the question the page asks", () => {
    // A count including rows the page filters out is a badge telling a member how many things they
    // are not allowed to see.
    const page: RecordedStatement[] = [];
    const count: RecordedStatement[] = [];
    selectNotificationFeedStatement(
      recordingDatabase(page),
      { recipientUserId: "user_reader", visibility: visibleMatterPredicate(), state: "unread" },
      { cursor: undefined, pageSize: 25 },
    );
    selectUnreadNotificationCountStatement(recordingDatabase(count), {
      recipientUserId: "user_reader",
      visibility: visibleMatterPredicate(),
    });
    // Compare the clause that follows the shared FROM, so the page's projection subqueries (which
    // contain their own WHERE) do not confuse the slice. Byte-identical here means the two reads
    // cannot answer different questions.
    const predicateOf = (sql: string) => {
      const fromAt = sql.lastIndexOf("FROM notification_recipient JOIN");
      const orderAt = sql.indexOf(" ORDER BY");
      return sql.slice(fromAt, orderAt === -1 ? undefined : orderAt);
    };
    expect(predicateOf(count[0]?.sql ?? "")).toBe(predicateOf(page[0]?.sql ?? ""));
    expect(count[0]?.bindings).toEqual(page[0]?.bindings.slice(0, count[0]?.bindings.length));
  });
});
