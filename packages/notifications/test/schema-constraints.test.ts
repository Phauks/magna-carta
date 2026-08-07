import { beforeEach, describe, expect, it } from "vitest";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";

// The two tables slice 1 CREATES but does not yet WRITE — the outbound-delivery row and the digest
// watermark. Their constraints are exercised here rather than left until the channel that writes
// them ships, because a CHECK that is wrong is a migration to fix on a growing table, and the whole
// reason the channel set is seeded up front is to never have to rebuild one of these.

type Database = ReturnType<typeof createMigratedNodeDatabase>["database"];

const NOW = "2026-08-07T02:00:00.000Z";

let database: Database;

// The node:sqlite adapter runs its statement synchronously and only then wraps the result in a
// promise, so a constraint violation THROWS out of the call rather than rejecting the promise it
// would otherwise have returned. Both shapes are the same fact — the database refused the write —
// so they are normalized here rather than in every assertion.
async function expectRefused(act: () => Promise<unknown>): Promise<void> {
  await expect(Promise.resolve().then(act)).rejects.toThrow();
}

async function expectAccepted(act: () => Promise<unknown>): Promise<void> {
  await expect(Promise.resolve().then(act)).resolves.toBeDefined();
}

async function insertEventAndRecipient(): Promise<string> {
  await database
    .prepare(
      "INSERT INTO notification_event (id, kind, category, severity, subject_kind, subject_id, matter_id, occurred_at, facts, dedupe_key, created_at) VALUES ('notificationEvent_c1', 'system.matter.closed', 'system', 'informational', 'matter', 'matter_c1', NULL, ?1, NULL, 'k1', ?1)",
    )
    .bind(NOW)
    .run();
  await database
    .prepare(
      "INSERT INTO notification_recipient (id, notification_event_id, recipient_user_id, state, read_at, dismissed_at, created_at) VALUES ('notificationRecipient_c1', 'notificationEvent_c1', 'user_c1', 'unread', NULL, NULL, ?1)",
    )
    .bind(NOW)
    .run();
  return "notificationRecipient_c1";
}

function insertDelivery(
  recipientId: string,
  channel: string,
  state: string,
  suppressedReason: string | null,
): Promise<unknown> {
  return database
    .prepare(
      "INSERT INTO notification_delivery (id, notification_recipient_id, channel, state, attempts, suppressed_reason, digest_id, dispatched_at, created_at) VALUES (?1, ?2, ?3, ?4, 0, ?5, NULL, NULL, ?6)",
    )
    .bind(
      `notificationDelivery_${channel}${state}`,
      recipientId,
      channel,
      state,
      suppressedReason,
      NOW,
    )
    .run();
}

beforeEach(() => {
  database = createMigratedNodeDatabase("per-firm").database;
});

describe("the outbound-delivery row", () => {
  it("accepts every channel the CHECK was seeded with, including the ones nothing writes", async () => {
    // Seeded from the first migration precisely so widening it later never rebuilds this table.
    const recipientId = await insertEventAndRecipient();
    for (const channel of ["in_app", "email", "push", "sms", "desktop"]) {
      await expectAccepted(() => insertDelivery(recipientId, channel, "pending", null));
    }
  });

  it("refuses a channel outside the set", async () => {
    const recipientId = await insertEventAndRecipient();
    await expectRefused(() => insertDelivery(recipientId, "carrier-pigeon", "pending", null));
  });

  it("insists a suppression names its reason, and that nothing else carries one", async () => {
    // "We decided not to email you about this" is a fact a support conversation needs, and an absent
    // reason answers nothing. The converse matters too: a reason on a sent row would be a support
    // record contradicting itself.
    const recipientId = await insertEventAndRecipient();
    await expectRefused(() => insertDelivery(recipientId, "email", "suppressed", null));
    await expectRefused(() => insertDelivery(recipientId, "push", "sent", "preference"));
    await expectAccepted(() => insertDelivery(recipientId, "sms", "suppressed", "not-visible"));
  });

  it("refuses a suppression reason outside the closed label set", async () => {
    // The reason is a LABEL and never a sentence — a free-text reason on a not-visible suppression
    // would record what was withheld, which is the existence oracle the whole rule avoids.
    const recipientId = await insertEventAndRecipient();
    await expectRefused(() =>
      insertDelivery(recipientId, "email", "suppressed", "the member cannot see matter 8181-3"),
    );
  });

  it("allows at most one row per recipient per channel", async () => {
    const recipientId = await insertEventAndRecipient();
    await insertDelivery(recipientId, "email", "pending", null);
    await expectRefused(() =>
      database
        .prepare(
          "INSERT INTO notification_delivery (id, notification_recipient_id, channel, state, attempts, suppressed_reason, digest_id, dispatched_at, created_at) VALUES ('notificationDelivery_dup', ?1, 'email', 'pending', 0, NULL, NULL, NULL, ?2)",
        )
        .bind(recipientId, NOW)
        .run(),
    );
  });
});

describe("the digest watermark", () => {
  function insertRun(lastOccurredAt: string | null, lastEventId: string | null) {
    return database
      .prepare(
        "INSERT INTO notification_digest_run (id, recipient_user_id, cadence, last_occurred_at, last_event_id, last_run_at, created_at, updated_at) VALUES ('notificationDigest_w1', 'user_c1', 'daily', ?1, ?2, NULL, ?3, ?3)",
      )
      .bind(lastOccurredAt, lastEventId, NOW)
      .run();
  }

  it("accepts an unset watermark and a complete one", async () => {
    await expectAccepted(() => insertRun(null, null));
    database = createMigratedNodeDatabase("per-firm").database;
    await expectAccepted(() => insertRun(NOW, "notificationEvent_c1"));
  });

  it("refuses HALF a keyset cursor", async () => {
    // A run storing only the instant would carry or skip every event sharing it, which is exactly
    // the boundary a bare timestamp cannot express.
    await expectRefused(() => insertRun(NOW, null));
    await expectRefused(() => insertRun(null, "notificationEvent_c1"));
  });
});

describe("the feed row's own state", () => {
  it("insists a settled row names when it settled", async () => {
    // The state column and its instant are two spellings of one fact; a row where they disagree is
    // a feed entry whose badge and whose history contradict each other.
    await database
      .prepare(
        "INSERT INTO notification_event (id, kind, category, severity, subject_kind, subject_id, matter_id, occurred_at, facts, dedupe_key, created_at) VALUES ('notificationEvent_s1', 'system.matter.closed', 'system', 'informational', 'matter', 'matter_s1', NULL, ?1, NULL, 'k-s1', ?1)",
      )
      .bind(NOW)
      .run();
    const insertRecipient = (state: string, readAt: string | null, dismissedAt: string | null) =>
      database
        .prepare(
          "INSERT INTO notification_recipient (id, notification_event_id, recipient_user_id, state, read_at, dismissed_at, created_at) VALUES (?1, 'notificationEvent_s1', 'user_s1', ?2, ?3, ?4, ?5)",
        )
        .bind(`notificationRecipient_${state}${readAt ?? ""}`, state, readAt, dismissedAt, NOW)
        .run();

    await expectRefused(() => insertRecipient("read", null, null));
    await expectRefused(() => insertRecipient("dismissed", null, null));
    await expectRefused(() => insertRecipient("unread", NOW, null));
    await expectAccepted(() => insertRecipient("read", NOW, null));
  });
});
