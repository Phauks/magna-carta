import { beforeAll, describe, expect, it } from "vitest";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import {
  selectNotificationFeedStatement,
  selectUnreadNotificationCountStatement,
  type NotificationFeedRawRow,
} from "../src/read-statements.ts";
import { MAX_FEED_PAGE_SIZE } from "../src/types.ts";

// THE BOUND, not a wall-clock number. What matters about these reads is that their cost is set by
// the page size and the index, never by how much the firm has accumulated — so what is asserted is
// the statement count, the rows returned, and the plan the database chooses.

const NOW_BASE = Date.parse("2026-01-01T00:00:00.000Z");
const READER = "user_boundsreader000";
// Deliberately more rows than one page, and more than one member's worth, so a read that forgot its
// filter or its LIMIT would show up as a number rather than as a hunch.
const ROWS = 400;

let handle: ReturnType<typeof createMigratedNodeDatabase>;

beforeAll(async () => {
  handle = createMigratedNodeDatabase("per-firm");
  const database = handle.database;
  const random = seededRandomSource(11);
  const statements = [];
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at) VALUES (?1, 'Reader', 'active', 0, ?2)",
    )
    .bind(READER, "2026-01-01T00:00:00.000Z")
    .run();
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at) VALUES (?1, 'Bounded', 'open', ?2, 0, ?3, ?3)",
    )
    .bind("matter_bounds0000001", READER, "2026-01-01T00:00:00.000Z")
    .run();

  for (let index = 0; index < ROWS; index++) {
    const at = new Date(NOW_BASE + index * 60_000).toISOString();
    const eventId = newIdentifier("notificationEvent", random);
    statements.push(
      database
        .prepare(
          "INSERT INTO notification_event (id, kind, category, severity, subject_kind, subject_id, matter_id, occurred_at, facts, dedupe_key, created_at) VALUES (?1, 'system.matter.closed', 'system', 'informational', 'matter', ?2, ?2, ?3, NULL, ?4, ?3)",
        )
        .bind(eventId, "matter_bounds0000001", at, `system.matter.closed:outbox_${index}`),
      database
        .prepare(
          "INSERT INTO notification_recipient (id, notification_event_id, recipient_user_id, state, read_at, dismissed_at, created_at) VALUES (?1, ?2, ?3, 'unread', NULL, NULL, ?4)",
        )
        .bind(newIdentifier("notificationRecipient", random), eventId, READER, at),
      // A second member's copy of the same event, so a read that dropped its user filter would
      // double its result rather than merely being wrong somewhere invisible.
      database
        .prepare(
          "INSERT INTO notification_recipient (id, notification_event_id, recipient_user_id, state, read_at, dismissed_at, created_at) VALUES (?1, ?2, 'user_boundsother0000', 'unread', NULL, NULL, ?3)",
        )
        .bind(newIdentifier("notificationRecipient", random), eventId, at),
    );
  }
  await database.batch(statements);
});

describe("the feed page's bound", () => {
  it("returns at most one page plus the has-more probe, whatever the firm has accumulated", async () => {
    const { results } = await selectNotificationFeedStatement(
      handle.database,
      { recipientUserId: READER, visibility: visibleMatterPredicate() },
      { cursor: undefined, pageSize: MAX_FEED_PAGE_SIZE },
    ).all<NotificationFeedRawRow>();
    // pageSize + 1: the extra row is how the caller tells "there is more" from "that is all"
    // without a second count.
    expect(results).toHaveLength(MAX_FEED_PAGE_SIZE + 1);
  });

  it("clamps a caller asking for more than the cap", async () => {
    const { results } = await selectNotificationFeedStatement(
      handle.database,
      { recipientUserId: READER, visibility: visibleMatterPredicate() },
      { cursor: undefined, pageSize: 5_000 },
    ).all<NotificationFeedRawRow>();
    expect(results).toHaveLength(MAX_FEED_PAGE_SIZE + 1);
  });

  it("walks the composite index rather than scanning the member's whole history", () => {
    // (recipient_user_id, state, created_at, id): the filter columns lead, then the ordering pair
    // the keyset walks. A plan that sorts instead of walking would still return the right page, and
    // would get slower every week — which is exactly the kind of regression a wall-clock assertion
    // notices too late.
    const statement = selectNotificationFeedStatement(
      handle.database,
      { recipientUserId: READER, visibility: visibleMatterPredicate(), state: "unread" },
      { cursor: undefined, pageSize: MAX_FEED_PAGE_SIZE },
    );
    const plan = handle.raw
      .prepare(`EXPLAIN QUERY PLAN ${statement.sql}`)
      .all(...(statement.bindings as string[])) as { detail: string }[];
    const text = plan.map((row) => row.detail).join(" | ");
    expect(text).toContain("notification_recipient_user_state_created_index");
    expect(text).not.toContain("USE TEMP B-TREE FOR ORDER BY");
  });

  it("keeps the unread count on the same index", async () => {
    const statement = selectUnreadNotificationCountStatement(handle.database, {
      recipientUserId: READER,
      visibility: visibleMatterPredicate(),
    });
    const plan = handle.raw
      .prepare(`EXPLAIN QUERY PLAN ${statement.sql}`)
      .all(...(statement.bindings as string[])) as { detail: string }[];
    expect(plan.map((row) => row.detail).join(" | ")).toContain(
      "notification_recipient_user_state_created_index",
    );
    const { results } = await statement.all<{ unread_count: number }>();
    // One member's rows only. Twice this would mean the user filter was dropped.
    expect(results[0]?.unread_count).toBe(ROWS);
  });

  it("walks the whole feed in bounded pages without repeating or skipping a row", async () => {
    // The keyset's real job. A cursor that meant something different from page to page would show
    // up here as a duplicate or a gap rather than as a mysterious support ticket.
    const seen = new Set<string>();
    let cursor: { createdAt: string; id: string } | undefined;
    let pages = 0;
    for (;;) {
      const { results } = await selectNotificationFeedStatement(
        handle.database,
        { recipientUserId: READER, visibility: visibleMatterPredicate() },
        { cursor, pageSize: MAX_FEED_PAGE_SIZE },
      ).all<NotificationFeedRawRow>();
      pages++;
      const kept = results.slice(0, MAX_FEED_PAGE_SIZE);
      for (const row of kept) {
        expect(seen.has(row.id)).toBe(false);
        seen.add(row.id);
      }
      if (results.length <= MAX_FEED_PAGE_SIZE) break;
      const last = kept.at(-1);
      if (last === undefined) break;
      cursor = { createdAt: last.created_at, id: last.id };
    }
    expect(seen.size).toBe(ROWS);
    expect(pages).toBe(Math.ceil(ROWS / MAX_FEED_PAGE_SIZE));
  });
});
