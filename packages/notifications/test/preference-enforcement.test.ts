import { beforeEach, describe, expect, it } from "vitest";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { LEDGER_ENTRY_POSTED_TOPIC } from "@magna-carta/ledger/post-entry";
import { MATTER_CLOSED_TOPIC } from "@magna-carta/matters/topics";
import type { UserId } from "@magna-carta/identifiers/types";
import {
  writeFirmNotificationPreferencesStatement,
  writeMemberNotificationPreferencesStatement,
  writeTrustComplianceRecipientsStatement,
} from "../src/preferences.ts";
import {
  selectNotificationFeedStatement,
  selectUnreadNotificationCountStatement,
  type NotificationFeedRawRow,
} from "../src/read-statements.ts";
import { retentionCutoff, retentionSweepSuppressionDeleteStatement } from "../src/retention.ts";
import { selectInAppSuppressionStatement } from "../src/suppression-statements.ts";
import { translateOutboxMessage } from "../src/translate.ts";

// A PREFERENCE STOPS A ROW, AND SAYS SO. Against the committed per-firm migrations, because the
// property under test is what ends up in the database: no feed row, and a counted one beside it.
//
// The one thing every case here is really checking: a suppression is never an absence. "Nobody was
// told" and "this person asked not to be told" have to be distinguishable afterwards, or a working
// setting and a broken fan-out look identical to the member and to the operator alike.

type Database = ReturnType<typeof createMigratedNodeDatabase>["database"];

const NOW = "2026-08-16T02:00:00.000Z";
const CIVIL_DATE = "2026-08-16";
const RESPONSIBLE = "user_responsible00000" as UserId;
const BOOKKEEPER = "user_bookkeeper000000" as UserId;
const COMPLIANCE = "user_compliance000000" as UserId;
const VISIBLE_MATTER = "matter_visible000000";
const HOLDING_MATTER = "matter_holding000000";

async function seed(database: Database): Promise<void> {
  for (const userId of [RESPONSIBLE, BOOKKEEPER, COMPLIANCE]) {
    await database
      .prepare(
        "INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at) VALUES (?1, ?2, 'active', 0, ?3)",
      )
      .bind(userId, `Member ${userId}`, NOW)
      .run();
  }
  // The bookkeeper is the only holder of trust:manage, which is what the trust kind's audience
  // resolves to. The compliance officer holds nothing — a designation must reach them anyway, and
  // must reach them WITHOUT becoming a grant of access.
  await database
    .prepare("INSERT INTO role (id, name, created_at) VALUES ('role_books000000000', 'Books', ?1)")
    .bind(NOW)
    .run();
  await database
    .prepare(
      "INSERT INTO role_permission (id, role_id, permission) VALUES ('rolePermission_tm001', 'role_books000000000', 'trust:manage')",
    )
    .run();
  await database
    .prepare(
      "INSERT INTO member_role (id, member_user_id, role_id) VALUES ('memberRole_books0001', ?1, 'role_books000000000')",
    )
    .bind(BOOKKEEPER)
    .run();

  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at) VALUES (?1, ?2, 'open', ?3, 0, ?4, ?4)",
    )
    .bind(VISIBLE_MATTER, "Visible Matter", RESPONSIBLE, NOW)
    .run();
  // The platform-owned holding matter: the row the visible-matter predicate really excludes today,
  // which is what makes the designation test a test rather than a rehearsal.
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, e_billing, system_key, created_at, updated_at) VALUES (?1, ?2, 'open', ?3, 0, 'custody-holding', ?4, ?4)",
    )
    .bind(HOLDING_MATTER, "Holding Matter", RESPONSIBLE, NOW)
    .run();
}

function closeMatter(database: Database, outboxRowId: string) {
  return translateOutboxMessage({
    database,
    outboxRowId,
    topic: MATTER_CLOSED_TOPIC,
    payload: JSON.stringify({ matterId: VISIBLE_MATTER }),
    now: () => NOW,
  });
}

function postLedgerEntry(database: Database, outboxRowId: string) {
  return translateOutboxMessage({
    database,
    outboxRowId,
    topic: LEDGER_ENTRY_POSTED_TOPIC,
    payload: JSON.stringify({ entryId: "ledgerEntry_posted01" }),
    now: () => NOW,
  });
}

async function feedFor(database: Database, userId: string): Promise<NotificationFeedRawRow[]> {
  const { results } = await selectNotificationFeedStatement(
    database,
    { recipientUserId: userId, visibility: visibleMatterPredicate() },
    { cursor: undefined, pageSize: 50 },
  ).all<NotificationFeedRawRow>();
  return results;
}

async function unreadCountFor(database: Database, userId: string): Promise<number> {
  const { results } = await selectUnreadNotificationCountStatement(database, {
    recipientUserId: userId,
    visibility: visibleMatterPredicate(),
  }).all<{ unread_count: number }>();
  return results[0]?.unread_count ?? 0;
}

async function suppressionsFor(database: Database, userId: string) {
  const { results } = await selectInAppSuppressionStatement(database, userId, "2000-01-01").all<{
    category: string;
    reason: string;
    suppressed_count: number;
    last_suppressed_at: string;
  }>();
  return results;
}

describe("a category silenced in app", () => {
  let database: Database;
  beforeEach(async () => {
    database = createMigratedNodeDatabase("per-firm").database;
    await seed(database);
  });

  it("writes NO feed row, and a counted suppression instead of nothing", async () => {
    await writeMemberNotificationPreferencesStatement(
      database,
      RESPONSIBLE,
      { system: { inApp: "off" } },
      NOW,
    ).run();

    const result = await closeMatter(database, "outbox_closed0000001");

    // Not a row somebody later discovers, and not a hidden one either: nothing was written.
    expect(await feedFor(database, RESPONSIBLE)).toEqual([]);
    expect(await unreadCountFor(database, RESPONSIBLE)).toBe(0);
    const { results: events } = await database
      .prepare("SELECT id FROM notification_event ORDER BY id")
      .all();
    expect(events).toEqual([]);

    // And the fact that a CHOICE is the reason, durably and per member.
    expect(await suppressionsFor(database, RESPONSIBLE)).toEqual([
      {
        category: "system",
        reason: "member-preference",
        suppressed_count: 1,
        last_suppressed_at: NOW,
      },
    ]);
    // Reported to the caller so it reaches a counter, with the two closed labels and nothing else.
    expect(result.suppressedInApp).toEqual([
      { category: "system", reason: "member-preference", count: 1 },
    ]);
  });

  it("is NOT counted as an empty audience", async () => {
    // An audience that resolved to nobody is a resolver problem; an audience everybody in it
    // silenced is a setting working as asked. Folding the second into the first would hide a
    // working preference behind a counter that means something is broken.
    await writeMemberNotificationPreferencesStatement(
      database,
      RESPONSIBLE,
      { system: { inApp: "off" } },
      NOW,
    ).run();
    const result = await closeMatter(database, "outbox_closed0000002");
    expect(result.emptyAudiences).toBe(0);
    expect(result.materializedEvents).toBe(0);
  });

  it("accumulates across a day rather than overwriting", async () => {
    await writeMemberNotificationPreferencesStatement(
      database,
      RESPONSIBLE,
      { system: { inApp: "off" } },
      NOW,
    ).run();
    await closeMatter(database, "outbox_closed0000003");
    await closeMatter(database, "outbox_closed0000004");
    const tally = await suppressionsFor(database, RESPONSIBLE);
    expect(tally[0]?.suppressed_count).toBe(2);
  });

  it("attributes a firm's own OFF to the firm rather than to the member", async () => {
    await writeFirmNotificationPreferencesStatement(
      database,
      { system: { inApp: "off" } },
      NOW,
    ).run();
    const result = await closeMatter(database, "outbox_closed0000005");
    expect(result.suppressedInApp).toEqual([
      { category: "system", reason: "firm-policy", count: 1 },
    ]);
    expect((await suppressionsFor(database, RESPONSIBLE))[0]?.reason).toBe("firm-policy");
  });
});

describe("what a preference may not reach", () => {
  let database: Database;
  beforeEach(async () => {
    database = createMigratedNodeDatabase("per-firm").database;
    await seed(database);
  });

  it("writes the feed row anyway where the firm raised the in-app floor", async () => {
    await writeFirmNotificationPreferencesStatement(
      database,
      { system: { inApp: "on" } },
      NOW,
    ).run();
    await writeMemberNotificationPreferencesStatement(
      database,
      RESPONSIBLE,
      { system: { inApp: "off" } },
      NOW,
    ).run();

    const result = await closeMatter(database, "outbox_closed0000006");
    expect(result.materializedEvents).toBe(1);
    expect(result.suppressedInApp).toEqual([]);
    expect(await feedFor(database, RESPONSIBLE)).toHaveLength(1);
    expect(await suppressionsFor(database, RESPONSIBLE)).toEqual([]);
  });

  it("writes a MANDATORY category's row however loudly both tiers say off", async () => {
    // The two categories that mirror the non-optional stance of the audit log. A firm cannot end up
    // in a position where nobody was told about a trust movement because everybody switched it off.
    await writeFirmNotificationPreferencesStatement(
      database,
      { trust: { inApp: "off" } },
      NOW,
    ).run();
    await writeMemberNotificationPreferencesStatement(
      database,
      BOOKKEEPER,
      { trust: { inApp: "off" } },
      NOW,
    ).run();

    const result = await postLedgerEntry(database, "outbox_ledger0000001");
    expect(result.materializedEvents).toBe(1);
    expect(result.suppressedInApp).toEqual([]);
    expect(await feedFor(database, BOOKKEEPER)).toHaveLength(1);
  });
});

describe("the firm's trust-compliance designation", () => {
  let database: Database;
  beforeEach(async () => {
    database = createMigratedNodeDatabase("per-firm").database;
    await seed(database);
  });

  it("adds designated members to a trust notification the kind's own audience never reached", async () => {
    // The compliance officer holds no capability at all. The designation is a firm saying "this
    // person hears about trust", over and above whoever can act on it.
    await writeTrustComplianceRecipientsStatement(database, [COMPLIANCE], NOW).run();
    const result = await postLedgerEntry(database, "outbox_ledger0000002");

    expect(result.designatedRecipients).toBe(1);
    expect(result.recipientRows).toBe(2);
    expect(await feedFor(database, COMPLIANCE)).toHaveLength(1);
    expect(await feedFor(database, BOOKKEEPER)).toHaveLength(1);
  });

  it("adds nobody where no firm has configured it", async () => {
    const result = await postLedgerEntry(database, "outbox_ledger0000003");
    expect(result.designatedRecipients).toBe(0);
    expect(await feedFor(database, COMPLIANCE)).toEqual([]);
  });

  it("does not double-count a designated member the audience already reached", async () => {
    await writeTrustComplianceRecipientsStatement(database, [BOOKKEEPER], NOW).run();
    const result = await postLedgerEntry(database, "outbox_ledger0000004");
    expect(result.designatedRecipients).toBe(0);
    expect(result.recipientRows).toBe(1);
  });

  it("does not let a designation reach past the wall — no feed row, no count, NO PLACEHOLDER", async () => {
    // A DESIGNATION IS NOT A GRANT OF ACCESS. The designated member is added to the recipient set
    // and nothing else: the visibility filter still decides, at read, what those rows may show
    // them. A "1 item you cannot see" row would be an existence oracle, which is the exact failure
    // the 404-not-403 posture exists to prevent.
    //
    // No registered trust kind is matter-anchored today, so the row a future one would write is
    // composed here directly — the recipient row the fan-out writes for a designated member, on a
    // matter the predicate excludes.
    await writeTrustComplianceRecipientsStatement(database, [COMPLIANCE], NOW).run();
    await database
      .prepare(
        "INSERT INTO notification_event (id, kind, category, severity, subject_kind, subject_id, matter_id, occurred_at, facts, dedupe_key, created_at) VALUES ('notificationEvent_d1', 'trust.ledger.entry.posted', 'trust', 'attention', 'ledgerEntry', 'ledgerEntry_screened1', ?1, ?2, NULL, 'screened:1', ?2)",
      )
      .bind(HOLDING_MATTER, NOW)
      .run();
    await database
      .prepare(
        "INSERT INTO notification_recipient (id, notification_event_id, recipient_user_id, state, read_at, dismissed_at, created_at) VALUES ('notificationRecipient_d1', 'notificationEvent_d1', ?1, 'unread', NULL, NULL, ?2)",
      )
      .bind(COMPLIANCE, NOW)
      .run();

    // Byte-identical to a firm where the notification was never raised at all.
    expect(await feedFor(database, COMPLIANCE)).toEqual([]);
    expect(await unreadCountFor(database, COMPLIANCE)).toBe(0);
  });
});

describe("the suppression tally's own lifetime", () => {
  it("ages out on the same window as the notifications it accounts for", async () => {
    // Left standing it would become a growing record of one member's settings with nothing left to
    // compare it against, since the feed rows it explains are gone.
    const database = createMigratedNodeDatabase("per-firm").database;
    await seed(database);
    await writeMemberNotificationPreferencesStatement(
      database,
      RESPONSIBLE,
      { system: { inApp: "off" } },
      NOW,
    ).run();
    await closeMatter(database, "outbox_closed0000007");
    expect(await suppressionsFor(database, RESPONSIBLE)).toHaveLength(1);

    // Ninety days on, the same nightly pass that takes the notifications takes the tally.
    const later = "2026-12-16T02:00:00.000Z";
    await retentionSweepSuppressionDeleteStatement(database, retentionCutoff(later, 90)).run();
    expect(await suppressionsFor(database, RESPONSIBLE)).toEqual([]);
  });

  it("keeps a tally still inside the window", async () => {
    const database = createMigratedNodeDatabase("per-firm").database;
    await seed(database);
    await writeMemberNotificationPreferencesStatement(
      database,
      RESPONSIBLE,
      { system: { inApp: "off" } },
      NOW,
    ).run();
    await closeMatter(database, "outbox_closed0000008");
    await retentionSweepSuppressionDeleteStatement(
      database,
      retentionCutoff("2026-08-20T02:00:00.000Z", 90),
    ).run();
    const tally = await suppressionsFor(database, RESPONSIBLE);
    expect(tally).toHaveLength(1);
    expect(tally[0]?.category).toBe("system");
  });

  it("buckets by the civil day the fan-out ran on", async () => {
    const database = createMigratedNodeDatabase("per-firm").database;
    await seed(database);
    await writeMemberNotificationPreferencesStatement(
      database,
      RESPONSIBLE,
      { system: { inApp: "off" } },
      NOW,
    ).run();
    await closeMatter(database, "outbox_closed0000009");
    const { results } = await database
      .prepare(
        "SELECT civil_date FROM notification_in_app_suppression ORDER BY recipient_user_id, category, civil_date, reason",
      )
      .all<{ civil_date: string }>();
    expect(results.map((row) => row.civil_date)).toEqual([CIVIL_DATE]);
  });
});
