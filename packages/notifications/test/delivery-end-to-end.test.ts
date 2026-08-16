import { beforeEach, describe, expect, it } from "vitest";
import {
  visibleMatterPredicate,
  visibleMatterPredicateExcluding,
} from "@magna-carta/calendar/visibility";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  createMigratedNodeDatabase,
  type NodeSqlStatement,
} from "@magna-carta/database/node-sqlite";
import { MATTER_CLOSED_TOPIC } from "@magna-carta/matters/topics";
import {
  DOCUMENT_CHECKIN_CONFLICT_TOPIC,
  FILE_QUARANTINED_TOPIC,
} from "@magna-carta/file-manager/topics";
import {
  selectNotificationFeedStatement,
  selectOwnNotificationStatement,
  selectSweptUnreadStatement,
  selectUnreadNotificationCountStatement,
  type NotificationFeedRawRow,
} from "../src/read-statements.ts";
import {
  clearSweptUnreadStatement,
  markNotificationReadStatement,
  markNotificationsReadThroughStatement,
} from "../src/statements.ts";
import {
  recordSweptUnreadStatement,
  retentionCutoff,
  retentionSweepDeleteStatements,
  selectSweepableUnreadTallyStatement,
} from "../src/retention.ts";
import { translateOutboxMessage } from "../src/translate.ts";

// The slice end to end, against the committed per-firm migrations rather than a fake: a real
// outbox message in, real rows out, read back through the same statements the routes use.

type Database = ReturnType<typeof createMigratedNodeDatabase>["database"];

// The statement builders type their return as the narrower D1-shaped SqlStatement; this database's
// batch() takes the node-sqlite shape the same objects actually have at runtime. Same narrowing as
// packages/fixtures/src/load-profile/costs-measurements.ts.
function capturedStatement(statement: SqlStatement): NodeSqlStatement {
  return statement as NodeSqlStatement;
}

const NOW = "2026-08-07T02:00:00.000Z";
const RESPONSIBLE = "user_responsible00000";
const OTHER = "user_other0000000000";

async function seedFirm(database: Database): Promise<void> {
  for (const userId of [RESPONSIBLE, OTHER]) {
    await database
      .prepare(
        "INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at) VALUES (?1, ?2, 'active', 0, ?3)",
      )
      .bind(userId, `Member ${userId}`, NOW)
      .run();
  }
  // Two matters: an ordinary one, and a platform-owned holding matter — the row the visible-matter
  // predicate really excludes today, which is what makes the wall test a test rather than a rehearsal.
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at) VALUES (?1, ?2, 'open', ?3, 0, ?4, ?4)",
    )
    .bind("matter_visible000000", "Visible Matter", RESPONSIBLE, NOW)
    .run();
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, e_billing, system_key, created_at, updated_at) VALUES (?1, ?2, 'open', ?3, 0, 'custody-holding', ?4, ?4)",
    )
    .bind("matter_holding000000", "Holding Matter", RESPONSIBLE, NOW)
    .run();
}

function translate(
  database: Database,
  options: { topic: string; payload: unknown; outboxRowId: string; now?: string },
) {
  return translateOutboxMessage({
    database,
    outboxRowId: options.outboxRowId,
    topic: options.topic,
    payload: JSON.stringify(options.payload),
    now: () => options.now ?? NOW,
  });
}

function feed(database: Database, userId: string, visibility = visibleMatterPredicate()) {
  return selectNotificationFeedStatement(
    database,
    { recipientUserId: userId, visibility },
    { cursor: undefined, pageSize: 50 },
  ).all<NotificationFeedRawRow>();
}

async function unreadCount(
  database: Database,
  userId: string,
  visibility = visibleMatterPredicate(),
): Promise<number> {
  const { results } = await selectUnreadNotificationCountStatement(database, {
    recipientUserId: userId,
    visibility,
  }).all<{ unread_count: number }>();
  return results[0]?.unread_count ?? 0;
}

describe("the subscriber pass", () => {
  let database: Database;
  beforeEach(async () => {
    database = createMigratedNodeDatabase("per-firm").database;
    await seedFirm(database);
  });

  it("acks and ignores a topic no type subscribes to", async () => {
    // The ORDINARY case for most of the thirty topics on this bus, and it must never throw —
    // throwing would dead-letter or retry-storm a message nobody handles.
    const result = await translate(database, {
      topic: "shipment.created",
      payload: { shipmentId: "shipment_x" },
      outboxRowId: "outbox_1",
    });
    expect(result.matchedTypes).toBe(0);
    expect(result.materializedEvents).toBe(0);
  });

  it("does not throw on a payload that will not parse", async () => {
    const result = await translateOutboxMessage({
      database,
      outboxRowId: "outbox_1",
      topic: MATTER_CLOSED_TOPIC,
      payload: "{not json",
      now: () => NOW,
    });
    expect(result.materializedEvents).toBe(0);
  });

  it("materializes one event and one recipient row from a subscribed topic", async () => {
    const result = await translate(database, {
      topic: MATTER_CLOSED_TOPIC,
      payload: { matterId: "matter_visible000000" },
      outboxRowId: "outbox_1",
    });
    expect(result.materializedEvents).toBe(1);
    expect(result.recipientRows).toBe(1);

    const { results } = await feed(database, RESPONSIBLE);
    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe("system.matter.closed");
    expect(results[0]?.matter_id).toBe("matter_visible000000");
  });

  it("REDELIVERY produces exactly one event and one recipient row", async () => {
    // Queues are at-least-once, so this is the ordinary case rather than the exceptional one. The
    // dedupe key is derived from the outbox row id, which is stable across redeliveries.
    for (let attempt = 0; attempt < 3; attempt++) {
      await translate(database, {
        topic: MATTER_CLOSED_TOPIC,
        payload: { matterId: "matter_visible000000" },
        outboxRowId: "outbox_1",
      });
    }
    const events = await database
      .prepare("SELECT COUNT(*) AS count FROM notification_event")
      .all<{ count: number }>();
    const recipients = await database
      .prepare("SELECT COUNT(*) AS count FROM notification_recipient")
      .all<{ count: number }>();
    expect(events.results[0]?.count).toBe(1);
    expect(recipients.results[0]?.count).toBe(1);
  });

  it("stores no string a person typed", async () => {
    // The matter's title is deliberately identifying in the fixture. If it ever appears in a
    // notification row, this fails — which is the point: the rule is structural, not a review note.
    await translate(database, {
      topic: MATTER_CLOSED_TOPIC,
      payload: { matterId: "matter_visible000000", matterTitle: "Ellison v. Braddock" },
      outboxRowId: "outbox_1",
    });
    const { results } = await database.prepare("SELECT * FROM notification_event").all();
    const serialized = JSON.stringify(results);
    expect(serialized).not.toContain("Ellison");
    expect(serialized).not.toContain("Visible Matter");
  });

  it("writes nothing when the audience resolves to nobody", async () => {
    // An event row nobody can see is a row only the retention sweep will ever touch.
    await database
      .prepare("UPDATE matter SET responsible_member_id = ?1 WHERE id = ?2")
      .bind(RESPONSIBLE, "matter_visible000000")
      .run();
    await database.prepare("DELETE FROM member WHERE user_id = ?1").bind(OTHER).run();
    const result = await translate(database, {
      topic: FILE_QUARANTINED_TOPIC,
      // No file_version row exists for this handle, so the matter cannot be resolved.
      payload: { versionId: "fileVersion_missing00" },
      outboxRowId: "outbox_2",
    });
    expect(result.materializedEvents).toBe(0);
    const events = await database
      .prepare("SELECT COUNT(*) AS count FROM notification_event")
      .all<{ count: number }>();
    expect(events.results[0]?.count).toBe(0);
  });

  it("REPORTS a producer that changed shape rather than throwing", async () => {
    // The check-in-conflict type declares `divergedFrom` and its producer has always supplied it.
    // A payload without it is a PRODUCER SHAPE CHANGE — permanent, and no retry makes it conform —
    // so the translator counts it and returns. Throwing would hand the caller a fault
    // indistinguishable from a database outage, and the caller's retry decision turns on exactly
    // that difference: it retries a transient fault and acks a permanent one.
    // Only the columns the matter lookup actually traverses (file_version -> file -> matter); every
    // other column on both tables is nullable or defaulted, so the fixture stays the minimum that
    // makes the join resolve.
    await database
      .prepare(
        "INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES ('file_conflict000001', 'matter_visible000000', 'x', ?1, ?1)",
      )
      .bind(NOW)
      .run();
    await database
      .prepare(
        "INSERT INTO file_version (id, file_id, version_number, r2_key, status, uploaded_by, created_at) VALUES ('fileVersion_conflict1', 'file_conflict000001', 1, 'k', 'clean', ?1, ?2)",
      )
      .bind(RESPONSIBLE, NOW)
      .run();

    const result = await translate(database, {
      topic: DOCUMENT_CHECKIN_CONFLICT_TOPIC,
      payload: { versionId: "fileVersion_conflict1", fileId: "file_conflict000001" },
      outboxRowId: "outbox_shape_change",
    });
    expect(result.refusedFacts).toBe(1);
    expect(result.materializedEvents).toBe(0);
    const events = await database
      .prepare("SELECT COUNT(*) AS count FROM notification_event")
      .all<{ count: number }>();
    expect(events.results[0]?.count).toBe(0);
  });
});

describe("the wall, at delivery time", () => {
  let database: Database;
  beforeEach(async () => {
    database = createMigratedNodeDatabase("per-firm").database;
    await seedFirm(database);
    await translate(database, {
      topic: MATTER_CLOSED_TOPIC,
      payload: { matterId: "matter_visible000000" },
      outboxRowId: "outbox_1",
    });
  });

  it("hides a row whose matter stops being visible, WITHOUT mutating the row", async () => {
    const before = await feed(database, RESPONSIBLE);
    expect(before.results).toHaveLength(1);

    const narrowed = visibleMatterPredicateExcluding(["matter_visible000000"]);
    const after = await feed(database, RESPONSIBLE, narrowed);
    expect(after.results).toHaveLength(0);

    // Nothing was deleted or rewritten — the row is filtered, and becomes visible again if access
    // returns. That is the whole reason the wall binds at read rather than at emission.
    const stored = await database
      .prepare("SELECT COUNT(*) AS count FROM notification_recipient")
      .all<{ count: number }>();
    expect(stored.results[0]?.count).toBe(1);
    expect((await feed(database, RESPONSIBLE)).results).toHaveLength(1);
  });

  it("keeps the unread count exactly equal to the filtered page count", async () => {
    // A count including rows the page filters out is a badge telling a member how many things they
    // are not allowed to see.
    const narrowed = visibleMatterPredicateExcluding(["matter_visible000000"]);
    expect(await unreadCount(database, RESPONSIBLE, narrowed)).toBe(0);
    expect((await feed(database, RESPONSIBLE, narrowed)).results).toHaveLength(0);
    expect(await unreadCount(database, RESPONSIBLE)).toBe(1);
  });

  it("emits NO placeholder for a filtered row", async () => {
    // "1 item you cannot see" is an existence oracle, which is the exact failure the platform's
    // 404-not-403 posture exists to prevent.
    const narrowed = visibleMatterPredicateExcluding(["matter_visible000000"]);
    const { results } = await feed(database, RESPONSIBLE, narrowed);
    expect(results).toEqual([]);
  });

  it("never shows one member another member's feed", async () => {
    expect((await feed(database, OTHER)).results).toHaveLength(0);
    expect(await unreadCount(database, OTHER)).toBe(0);
  });

  it("does not resolve another member's row by its handle", async () => {
    const own = await feed(database, RESPONSIBLE);
    const handle = own.results[0]?.id ?? "";
    const { results } = await selectOwnNotificationStatement(
      database,
      { recipientUserId: OTHER, visibility: visibleMatterPredicate() },
      handle,
    ).all<{ id: string }>();
    // Not found rather than forbidden: a distinguishable refusal tells the caller the row exists.
    expect(results).toEqual([]);
  });
});

describe("settling a feed row", () => {
  let database: Database;
  beforeEach(async () => {
    database = createMigratedNodeDatabase("per-firm").database;
    await seedFirm(database);
    await translate(database, {
      topic: MATTER_CLOSED_TOPIC,
      payload: { matterId: "matter_visible000000" },
      outboxRowId: "outbox_1",
    });
  });

  it("is idempotent: a second mark-read changes nothing", async () => {
    const { results } = await feed(database, RESPONSIBLE);
    const id = results[0]?.id ?? "";
    for (let attempt = 0; attempt < 2; attempt++) {
      await markNotificationReadStatement(database, {
        notificationRecipientId: id,
        recipientUserId: RESPONSIBLE,
        now: NOW,
      }).run();
    }
    const after = await feed(database, RESPONSIBLE);
    expect(after.results[0]?.state).toBe("read");
    expect(after.results[0]?.read_at).toBe(NOW);
    expect(await unreadCount(database, RESPONSIBLE)).toBe(0);
  });

  it("cannot settle a row belonging to another member", async () => {
    const { results } = await feed(database, RESPONSIBLE);
    await markNotificationReadStatement(database, {
      notificationRecipientId: results[0]?.id ?? "",
      recipientUserId: OTHER,
      now: NOW,
    }).run();
    expect(await unreadCount(database, RESPONSIBLE)).toBe(1);
  });

  it("marks read only as far back as the cursor the caller handed over", async () => {
    // The bound is what keeps "mark all read" from clearing items that arrived after the page was
    // drawn — the member is saying "these", not "whatever is there when this lands".
    await translate(database, {
      topic: MATTER_CLOSED_TOPIC,
      payload: { matterId: "matter_visible000000" },
      outboxRowId: "outbox_2",
      now: "2026-08-07T03:00:00.000Z",
    });
    const { results } = await feed(database, RESPONSIBLE);
    expect(results).toHaveLength(2);
    // Newest first, so the OLDER row is last; bounding at it leaves the newer one unread.
    const older = results[1];
    await markNotificationsReadThroughStatement(database, {
      recipientUserId: RESPONSIBLE,
      throughCreatedAt: older?.created_at ?? "",
      throughId: older?.id ?? "",
      now: NOW,
    }).run();
    expect(await unreadCount(database, RESPONSIBLE)).toBe(1);
  });
});

describe("retention, and the unread it takes", () => {
  let database: Database;
  const LONG_AGO = "2026-01-01T00:00:00.000Z";

  beforeEach(async () => {
    database = createMigratedNodeDatabase("per-firm").database;
    await seedFirm(database);
    await translate(database, {
      topic: MATTER_CLOSED_TOPIC,
      payload: { matterId: "matter_visible000000" },
      outboxRowId: "outbox_old",
      now: LONG_AGO,
    });
    await translate(database, {
      topic: MATTER_CLOSED_TOPIC,
      payload: { matterId: "matter_visible000000" },
      outboxRowId: "outbox_new",
      now: NOW,
    });
  });

  async function sweep(retentionDays: number): Promise<void> {
    const cutoff = retentionCutoff(NOW, retentionDays);
    const { results: tally } = await selectSweepableUnreadTallyStatement(database, cutoff).all<{
      recipient_user_id: string;
      unread_count: number;
      oldest_occurred_at: string;
    }>();
    await database.batch(
      [
        ...tally.map((row) =>
          recordSweptUnreadStatement(database, {
            recipientUserId: row.recipient_user_id,
            unreadCount: row.unread_count,
            oldestOccurredAt: row.oldest_occurred_at,
            now: NOW,
          }),
        ),
        ...retentionSweepDeleteStatements(database, cutoff),
      ].map(capturedStatement),
    );
  }

  it("takes what is past the window and leaves what is not", async () => {
    await sweep(90);
    const { results } = await feed(database, RESPONSIBLE);
    expect(results).toHaveLength(1);
    expect(results[0]?.occurred_at).toBe(NOW);
  });

  it("never touches the source record the pointer named", async () => {
    // The whole retention posture rests on this: a notification is a pointer and the matter, the
    // timeline, and the audit log it pointed at are the record.
    await sweep(90);
    const { results } = await database
      .prepare("SELECT id FROM matter WHERE id = ?1")
      .bind("matter_visible000000")
      .all<{ id: string }>();
    expect(results).toHaveLength(1);
  });

  it("TALLIES the unread it took rather than dropping the fact", async () => {
    // A member back from leave who is shown a badge of zero has been told "there is nothing you
    // missed", which is a claim the platform is not in a position to make.
    await sweep(90);
    const { results } = await selectSweptUnreadStatement(database, RESPONSIBLE).all<{
      unread_count: number;
      oldest_swept_occurred_at: string | null;
    }>();
    expect(results[0]?.unread_count).toBe(1);
    expect(results[0]?.oldest_swept_occurred_at).toBe(LONG_AGO);
    // And the live count still means only what is live.
    expect(await unreadCount(database, RESPONSIBLE)).toBe(1);
  });

  it("accumulates across passes and only ever moves the oldest instant backward", async () => {
    await sweep(90);
    await translate(database, {
      topic: MATTER_CLOSED_TOPIC,
      payload: { matterId: "matter_visible000000" },
      outboxRowId: "outbox_older",
      now: "2025-12-01T00:00:00.000Z",
    });
    await sweep(90);
    const { results } = await selectSweptUnreadStatement(database, RESPONSIBLE).all<{
      unread_count: number;
      oldest_swept_occurred_at: string | null;
    }>();
    expect(results[0]?.unread_count).toBe(2);
    expect(results[0]?.oldest_swept_occurred_at).toBe("2025-12-01T00:00:00.000Z");
  });

  it("does not tally a row the member had already read", async () => {
    const { results } = await feed(database, RESPONSIBLE);
    const oldest = results.at(-1);
    await markNotificationReadStatement(database, {
      notificationRecipientId: oldest?.id ?? "",
      recipientUserId: RESPONSIBLE,
      now: NOW,
    }).run();
    await sweep(90);
    const tally = await selectSweptUnreadStatement(database, RESPONSIBLE).all<{
      unread_count: number;
    }>();
    expect(tally.results[0]?.unread_count ?? 0).toBe(0);
  });

  it("clears the tally when the member says they have dealt with the backlog", async () => {
    await sweep(90);
    await clearSweptUnreadStatement(database, { recipientUserId: RESPONSIBLE, now: NOW }).run();
    const { results } = await selectSweptUnreadStatement(database, RESPONSIBLE).all<{
      unread_count: number;
      oldest_swept_occurred_at: string | null;
    }>();
    expect(results[0]?.unread_count).toBe(0);
    expect(results[0]?.oldest_swept_occurred_at).toBeNull();
  });
});
