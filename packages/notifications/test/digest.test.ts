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
import {
  composeDigest,
  newNotificationDigestId,
  readDigestCandidates,
  readDigestWindow,
  settleDigestStatements,
  type DigestComposition,
} from "../src/digest.ts";
import { NOTIFICATION_TYPES } from "../src/registry.ts";
import type { NotificationCategory, NotificationEmailCadence } from "../src/types.ts";
import { MAX_DIGEST_ITEMS_PER_RUN } from "../src/types.ts";

// The digest reader and its bookkeeping, against the committed per-firm migrations rather than a
// fake: real rows in, a real watermark out, read back through the same statements the cron pass uses.

type Database = ReturnType<typeof createMigratedNodeDatabase>["database"];

function capturedStatement(statement: SqlStatement): NodeSqlStatement {
  return statement as NodeSqlStatement;
}

const NOW = "2026-08-16T14:00:00.000Z";
const READER = "user_reader000000000";
const OTHER = "user_other0000000000";

let database: Database;

async function seedFirm(): Promise<void> {
  for (const userId of [READER, OTHER]) {
    await database
      .prepare(
        "INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at) VALUES (?1, ?2, 'active', 0, ?3)",
      )
      .bind(userId, `Member ${userId}`, NOW)
      .run();
  }
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at) VALUES (?1, ?2, 'open', ?3, 0, ?4, ?4)",
    )
    .bind("matter_visible000000", "Visible Matter", READER, NOW)
    .run();
  // The platform-owned holding matter — the row the visible-matter predicate actually excludes
  // today, which is what makes the wall assertion below a test rather than a rehearsal.
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, e_billing, system_key, created_at, updated_at) VALUES (?1, ?2, 'open', ?3, 0, 'custody-holding', ?4, ?4)",
    )
    .bind("matter_holding000000", "Holding Matter", READER, NOW)
    .run();
}

let sequence = 0;

// One notification, straight into the tables. Deliberately not through the translator: this suite is
// about the read and the settlement, and building rows directly is what lets a test place two events
// on the SAME instant, which is the case the keyset watermark exists for.
async function seedNotification(options: {
  readonly category: NotificationCategory;
  readonly kind?: string;
  readonly occurredAt?: string;
  readonly matterId?: string | null;
  readonly recipients?: readonly string[];
  readonly eventId?: string;
}): Promise<{ eventId: string; recipientIds: readonly string[] }> {
  sequence++;
  const eventId = options.eventId ?? `notificationEvent_${String(sequence).padStart(4, "0")}`;
  const occurredAt = options.occurredAt ?? NOW;
  await database
    .prepare(
      "INSERT INTO notification_event (id, kind, category, severity, subject_kind, subject_id, matter_id, occurred_at, facts, dedupe_key, created_at) VALUES (?1, ?2, ?3, 'informational', 'matter', 'matter_visible000000', ?4, ?5, NULL, ?6, ?5)",
    )
    .bind(
      eventId,
      options.kind ?? "system.matter.closed",
      options.category,
      options.matterId === undefined ? "matter_visible000000" : options.matterId,
      occurredAt,
      `dedupe_${eventId}`,
    )
    .run();
  const recipientIds: string[] = [];
  for (const [index, userId] of (options.recipients ?? [READER]).entries()) {
    const recipientId = `notificationRecipient_${String(sequence).padStart(4, "0")}_${index}`;
    await database
      .prepare(
        "INSERT INTO notification_recipient (id, notification_event_id, recipient_user_id, state, read_at, dismissed_at, created_at) VALUES (?1, ?2, ?3, 'unread', NULL, NULL, ?4)",
      )
      .bind(recipientId, eventId, userId, occurredAt)
      .run();
    recipientIds.push(recipientId);
  }
  return { eventId, recipientIds };
}

// Every category on `daily` unless the test says otherwise — the recommended default set for the
// categories these tests use.
function cadences(
  overrides: Partial<Record<NotificationCategory, NotificationEmailCadence>> = {},
): (category: NotificationCategory) => NotificationEmailCadence {
  return (category) => overrides[category] ?? "daily";
}

async function compose(
  overrides: Partial<Record<NotificationCategory, NotificationEmailCadence>> = {},
  visibility = visibleMatterPredicate(),
  after: Parameters<typeof readDigestWindow>[2] = null,
): Promise<DigestComposition> {
  const window = await readDigestWindow(database, { recipientUserId: READER, visibility }, after);
  return composeDigest({ cadence: "daily", window, cadenceForCategory: cadences(overrides) });
}

async function settle(composition: DigestComposition, digestId: string | null): Promise<void> {
  await database.batch(
    settleDigestStatements(database, {
      recipientUserId: READER,
      cadence: "daily",
      composition,
      digestId: digestId as never,
      now: NOW,
    }).map(capturedStatement),
  );
}

async function storedWatermark(): Promise<{
  last_occurred_at: string | null;
  last_event_id: string | null;
  last_run_at: string | null;
} | null> {
  const { results } = await database
    .prepare(
      "SELECT last_occurred_at, last_event_id, last_run_at FROM notification_digest_run WHERE recipient_user_id = ?1 AND cadence = 'daily' ORDER BY id LIMIT 1",
    )
    .bind(READER)
    .all<{
      last_occurred_at: string | null;
      last_event_id: string | null;
      last_run_at: string | null;
    }>();
  return results[0] ?? null;
}

async function deliveries(): Promise<
  {
    notification_recipient_id: string;
    state: string;
    suppressed_reason: string | null;
    digest_id: string | null;
  }[]
> {
  const { results } = await database
    .prepare(
      "SELECT notification_recipient_id, state, suppressed_reason, digest_id FROM notification_delivery ORDER BY notification_recipient_id",
    )
    .all<{
      notification_recipient_id: string;
      state: string;
      suppressed_reason: string | null;
      digest_id: string | null;
    }>();
  return results;
}

beforeEach(async () => {
  sequence = 0;
  database = createMigratedNodeDatabase("per-firm").database;
  await seedFirm();
});

describe("the digest window", () => {
  it("counts per category and carries no per-item anything", async () => {
    await seedNotification({ category: "deadlines" });
    await seedNotification({ category: "deadlines" });
    await seedNotification({ category: "trust" });

    const composition = await compose();

    expect(composition.counts).toEqual([
      { category: "deadlines", count: 2 },
      { category: "trust", count: 1 },
    ]);
    expect(composition.totalCount).toBe(3);
    expect(composition.atLeast).toBe(false);
    expect(composition.carriedRecipientIds).toHaveLength(3);
  });

  it("filters by matter visibility in SQL, so an invisible matter is absent rather than hidden", async () => {
    await seedNotification({ category: "deadlines" });
    await seedNotification({ category: "trust", matterId: "matter_holding000000" });

    const composition = await compose();

    // No placeholder, no "1 hidden", no gap in a count: the holding matter's notification simply is
    // not in the window, exactly as it is not in the feed.
    expect(composition.counts).toEqual([{ category: "deadlines", count: 1 }]);
    expect(composition.totalCount).toBe(1);
  });

  it("stops carrying a category the reader's visibility no longer reaches, with no row mutated", async () => {
    await seedNotification({ category: "deadlines" });
    const before = await compose();
    expect(before.totalCount).toBe(1);

    const after = await compose({}, visibleMatterPredicateExcluding(["matter_visible000000"]));

    expect(after.totalCount).toBe(0);
    const { results } = await database
      .prepare("SELECT COUNT(*) AS live FROM notification_recipient")
      .all<{ live: number }>();
    expect(results[0]?.live).toBe(1);
  });

  it("reads only the asking member's rows", async () => {
    await seedNotification({ category: "deadlines", recipients: [OTHER] });
    expect((await compose()).totalCount).toBe(0);
  });

  it("carries a firm-scoped notification, which has no matter whose visibility could decide it", async () => {
    await seedNotification({ category: "system", matterId: null });
    expect((await compose()).counts).toEqual([{ category: "system", count: 1 }]);
  });

  it("walks past two events sharing an instant without carrying or dropping either", async () => {
    // The whole reason the watermark is a PAIR. A bare timestamp would either re-carry the second
    // event forever or skip it on the first pass.
    const first = await seedNotification({
      category: "deadlines",
      eventId: "notificationEvent_aaaa",
      occurredAt: NOW,
    });
    await seedNotification({
      category: "deadlines",
      eventId: "notificationEvent_bbbb",
      occurredAt: NOW,
    });

    const resumed = await compose({}, visibleMatterPredicate(), {
      lastOccurredAt: NOW,
      lastEventId: first.eventId,
    });

    expect(resumed.totalCount).toBe(1);
    expect(resumed.advanceTo).toEqual({
      lastOccurredAt: NOW,
      lastEventId: "notificationEvent_bbbb",
    });
  });

  it("reports a clamped window as a floor rather than as an exact count", async () => {
    for (let index = 0; index < 3; index++) {
      await seedNotification({ category: "deadlines" });
    }
    const window = await readDigestWindow(
      database,
      { recipientUserId: READER, visibility: visibleMatterPredicate() },
      null,
      2,
    );
    const composition = composeDigest({
      cadence: "daily",
      window,
      cadenceForCategory: cadences(),
    });

    expect(composition.atLeast).toBe(true);
    expect(composition.totalCount).toBe(2);
  });
});

describe("what a cadence decides", () => {
  it("withholds a category the member set to off, and records the reason against every row", async () => {
    await seedNotification({ category: "deadlines" });
    await seedNotification({ category: "trust" });

    const composition = await compose({ trust: "off" });

    expect(composition.counts).toEqual([{ category: "deadlines", count: 1 }]);
    expect(composition.withheld).toHaveLength(1);
    expect(composition.withheld[0]?.reason).toBe("preference");
  });

  it("leaves a category on the other cadence to the other cadence's own walk", async () => {
    await seedNotification({ category: "trust" });
    const composition = await compose({ trust: "weekly" });

    // Not carried and not withheld: the weekly run keeps its own watermark and settles it there.
    expect(composition.totalCount).toBe(0);
    expect(composition.withheld).toHaveLength(0);
    expect(composition.deferred).toBe(1);
  });
});

describe("settling — an email that was not sent is as findable as one that was", () => {
  it("writes a sent delivery row per carried item and advances the watermark", async () => {
    const seeded = await seedNotification({ category: "deadlines" });
    const composition = await compose();
    const digestId = newNotificationDigestId();

    await settle(composition, digestId);

    const rows = await deliveries();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      notification_recipient_id: seeded.recipientIds[0],
      state: "sent",
      suppressed_reason: null,
      digest_id: digestId,
    });
    expect(await storedWatermark()).toMatchObject({
      last_occurred_at: NOW,
      last_event_id: seeded.eventId,
    });
  });

  it("writes a suppressed row naming the preference, so a silenced member is not an absence", async () => {
    const seeded = await seedNotification({ category: "trust" });
    const composition = await compose({ trust: "off" });

    await settle(composition, null);

    const rows = await deliveries();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      notification_recipient_id: seeded.recipientIds[0],
      state: "suppressed",
      suppressed_reason: "preference",
      // No summary carried it, so nothing claims one did.
      digest_id: null,
    });
  });

  it("distinguishes a member who chose not to be mailed from a member with no address", async () => {
    await seedNotification({ category: "deadlines" });
    const composition = await compose();

    await database.batch(
      settleDigestStatements(database, {
        recipientUserId: READER,
        cadence: "daily",
        composition,
        digestId: null,
        withholdAllReason: "no-address",
        now: NOW,
      }).map(capturedStatement),
    );

    const rows = await deliveries();
    expect(rows[0]).toMatchObject({ state: "suppressed", suppressed_reason: "no-address" });
  });

  it("records that a run happened even when it had nothing to say, and leaves the mark alone", async () => {
    const composition = await compose();
    expect(composition.totalCount).toBe(0);

    await settle(composition, null);

    // A member who has never been written to and a member with nothing to be written about are
    // different facts: the run is recorded, the watermark is not moved past rows that do not exist.
    expect(await storedWatermark()).toMatchObject({
      last_occurred_at: null,
      last_event_id: null,
      last_run_at: NOW,
    });
    expect(await deliveries()).toHaveLength(0);
  });

  it("re-sends after a crash between the send and the mark, and does not double-advance", async () => {
    const seeded = await seedNotification({ category: "deadlines" });

    // The send returned; the process died before the batch. Nothing was written.
    const crashed = await compose();
    expect(crashed.totalCount).toBe(1);
    expect(await storedWatermark()).toBeNull();

    // Next run reads the SAME window — at-least-once, which is the side of the trade a missed
    // deadline decides — and settles it once.
    const retried = await compose();
    expect(retried.totalCount).toBe(1);
    await settle(retried, newNotificationDigestId());

    expect(await deliveries()).toHaveLength(1);
    expect(await storedWatermark()).toMatchObject({ last_event_id: seeded.eventId });

    // And a third run has nothing left: the mark moved exactly once.
    const settled = await compose({}, visibleMatterPredicate(), {
      lastOccurredAt: NOW,
      lastEventId: seeded.eventId,
    });
    expect(settled.totalCount).toBe(0);
  });

  it("absorbs a re-settled row rather than writing a second delivery for one channel", async () => {
    await seedNotification({ category: "deadlines" });
    const composition = await compose();

    await settle(composition, newNotificationDigestId());
    await settle(composition, newNotificationDigestId());

    expect(await deliveries()).toHaveLength(1);
  });
});

describe("who a run has anything to say to", () => {
  it("lists a member with un-summarized rows and skips one whose mark has passed them", async () => {
    const seeded = await seedNotification({ category: "deadlines", recipients: [READER, OTHER] });

    // Ordered by member handle, which is what makes the walk resumable and the test deterministic.
    const before = await readDigestCandidates(database, "daily");
    expect(before.candidates.map((candidate) => candidate.recipientUserId)).toEqual(
      [READER, OTHER].toSorted(),
    );

    const composition = await compose();
    await settle(composition, newNotificationDigestId());

    const after = await readDigestCandidates(database, "daily");
    expect(after.candidates.map((candidate) => candidate.recipientUserId)).toEqual([OTHER]);
    expect(seeded.recipientIds).toHaveLength(2);
  });

  it("excludes a deactivated member, because this audience reaches a mailbox", async () => {
    await seedNotification({ category: "deadlines", recipients: [OTHER] });
    await database
      .prepare("UPDATE member SET status = 'deactivated' WHERE user_id = ?1")
      .bind(OTHER)
      .run();

    expect((await readDigestCandidates(database, "daily")).candidates).toEqual([]);
  });

  it("keeps the daily and the weekly walk on separate marks", async () => {
    await seedNotification({ category: "deadlines" });
    const composition = await compose();
    await settle(composition, newNotificationDigestId());

    expect((await readDigestCandidates(database, "daily")).candidates).toEqual([]);
    // The weekly walk has its own watermark and has not moved.
    expect(
      (await readDigestCandidates(database, "weekly")).candidates.map(
        (candidate) => candidate.recipientUserId,
      ),
    ).toEqual([READER]);
  });
});

describe("the escalation boundary", () => {
  it("registers no kind that may bypass the digest, so no summary can silently carry one", () => {
    // A kind declaring `immediate` needs a send path of its own; until one ships, the digest HALTS
    // at the first rather than folding a compliance-grade notice into a day's counts. This assertion
    // is what turns "that path is unbuilt" from a silent gap into a gate failure the day somebody
    // adds the type.
    for (const type of NOTIFICATION_TYPES) {
      expect(type.escalation, type.key).toBe("digest");
    }
  });

  it("puts every registered kind's email content at counts-only", () => {
    // `recipient-scoped` is declared for the account and security kinds that are about the reader
    // rather than a client. None is registered, and the renderer knows only how to count — so a type
    // declaring it must fail here rather than have its full content quietly dropped from a summary.
    for (const type of NOTIFICATION_TYPES) {
      expect(type.emailContent, type.key).toBe("category-count");
    }
  });

  it("halts the walk at an immediate kind instead of stepping over it", () => {
    // Driven through the escalation seam, because no registered kind declares `immediate` — which is
    // the point of the assertion above and also the reason the seam exists. This proves the halt
    // behaves, so the day the registry gains one the watermark stays behind it rather than settling
    // mail nobody sent.
    const composition = composeDigest({
      cadence: "daily",
      window: {
        rows: [
          {
            notification_recipient_id: "notificationRecipient_first",
            kind: "trust.ledger.entry.posted",
            category: "trust",
            occurred_at: NOW,
            notification_event_id: "notificationEvent_first",
          },
          {
            notification_recipient_id: "notificationRecipient_urgent",
            kind: "security.signIn.suspicious",
            category: "security",
            occurred_at: NOW,
            notification_event_id: "notificationEvent_urgent",
          },
          {
            notification_recipient_id: "notificationRecipient_after",
            kind: "trust.ledger.entry.posted",
            category: "trust",
            occurred_at: NOW,
            notification_event_id: "notificationEvent_zafter",
          },
        ],
        clamped: false,
      },
      cadenceForCategory: cadences(),
      escalationFor: (kind) => (kind === "security.signIn.suspicious" ? "immediate" : "digest"),
    });

    expect(composition.totalCount).toBe(1);
    expect(composition.refusedEscalation).toBe(2);
    // The mark stays on the last row the run actually accounted for — behind the immediate one.
    expect(composition.advanceTo).toEqual({
      lastOccurredAt: NOW,
      lastEventId: "notificationEvent_first",
    });
  });

  it("counts a kind the registry no longer knows rather than dropping it from the mail", () => {
    const composition = composeDigest({
      cadence: "daily",
      window: {
        rows: [
          {
            notification_recipient_id: "notificationRecipient_retired",
            kind: "a.kind.the.registry.forgot",
            category: "documents",
            occurred_at: NOW,
            notification_event_id: "notificationEvent_retired",
          },
        ],
        clamped: false,
      },
      cadenceForCategory: cadences(),
    });

    expect(composition.counts).toEqual([{ category: "documents", count: 1 }]);
  });
});

describe("the caps", () => {
  it("never reads more than the per-run item cap however large a limit is asked for", async () => {
    await seedNotification({ category: "deadlines" });
    const window = await readDigestWindow(
      database,
      { recipientUserId: READER, visibility: visibleMatterPredicate() },
      null,
      MAX_DIGEST_ITEMS_PER_RUN * 10,
    );
    expect(window.rows.length).toBeLessThanOrEqual(MAX_DIGEST_ITEMS_PER_RUN);
  });
});
