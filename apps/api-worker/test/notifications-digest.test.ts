import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, MatterId, UserId } from "@magna-carta/identifiers/types";
import { writeNotificationDigestLocalHourStatement } from "@magna-carta/notifications/settings";
import { writeMemberNotificationPreferencesStatement } from "@magna-carta/notifications/preferences";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import type { NotificationDigestSendPort } from "../src/notifications/digest-send-port.ts";
import { resolveNotificationDigestSendPort } from "../src/notifications/digest-send-port.ts";
import { runNotificationDigestPass } from "../src/background/scheduled.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";

// The digest pass driven through the real cron entry point, the real per-firm Durable Object, and
// the real control-plane address lookup. Only the transport is a stand-in — the Cloudflare Email
// Service binding cannot send from the local pool — and it is injected on the same terms the
// conversion engine resolver is, so everything up to the moment the bytes leave is the shipped path.

// A zone-free anchor: this firm sets no default office, so the pass anchors on the platform's clock
// and the hour below is a UTC hour. That is the documented fallback, and testing it is what proves
// a firm that has not said where it is still gets its mail.
const DIGEST_HOUR = 7;
// A Tuesday, so only the daily cadence fires. The two walks keeping separate marks is proved
// against the migrated lineage in packages/notifications/test/digest.test.ts; keeping this pass to
// one cadence is what makes the delivery-row counts below read as exactly what they are.
const AT_THE_HOUR = new Date("2026-08-18T07:04:00.000Z");
const OFF_THE_HOUR = new Date("2026-08-18T09:04:00.000Z");
const TS = "2026-08-16T12:00:00.000Z";

const READER = "user_digestReader000" as UserId;
const READER_ADDRESS = "reader@example-firm.test";

// The strings a firm actually types, planted where a careless renderer would find them.
const MATTER_TITLE = "Ellison v. Braddock";
const MATTER_NUMBER = "8181-3";

interface SentMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly messageClass?: string;
}

let firmId: FirmId;
let matterId: MatterId;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

function recordingPort(sent: SentMessage[]): NotificationDigestSendPort {
  return {
    status: "configured",
    appBaseUrl: "https://app.example",
    send: (message) => {
      sent.push(message);
      return Promise.resolve();
    },
  };
}

let seeded = 0;

async function seedNotification(category: string, kind: string): Promise<void> {
  seeded++;
  const eventId = `notificationEvent_dg${String(seeded).padStart(2, "0")}`;
  await firmDatabase
    .prepare(
      "INSERT INTO notification_event (id, kind, category, severity, subject_kind, subject_id, matter_id, occurred_at, facts, dedupe_key, created_at) VALUES (?1, ?2, ?3, 'attention', 'matter', ?4, ?4, ?5, NULL, ?6, ?5)",
    )
    .bind(eventId, kind, category, matterId, TS, `dedupe_${eventId}`)
    .run();
  await firmDatabase
    .prepare(
      "INSERT INTO notification_recipient (id, notification_event_id, recipient_user_id, state, read_at, dismissed_at, created_at) VALUES (?1, ?2, ?3, 'unread', NULL, NULL, ?4)",
    )
    .bind(`notificationRecipient_dg${String(seeded).padStart(2, "0")}`, eventId, READER, TS)
    .run();
}

async function deliveryStates(): Promise<{ state: string; suppressed_reason: string | null }[]> {
  const { results } = await firmDatabase
    .prepare(
      "SELECT state, suppressed_reason FROM notification_delivery ORDER BY notification_recipient_id",
    )
    .all<{ state: string; suppressed_reason: string | null }>();
  return results;
}

async function watermark(): Promise<{ last_event_id: string | null } | null> {
  const { results } = await firmDatabase
    .prepare(
      "SELECT last_event_id FROM notification_digest_run WHERE recipient_user_id = ?1 AND cadence = 'daily' ORDER BY id LIMIT 1",
    )
    .bind(READER)
    .all<{ last_event_id: string | null }>();
  return results[0] ?? null;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = newIdentifier("firm");
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
  await env.DB_CONTROL.prepare(
    "INSERT INTO firm (id, name, bucket_name, status, created_at) VALUES (?1, ?2, ?3, 'active', ?4)",
  )
    .bind(firmId, "Digest Firm", "digest-firm-bucket", TS)
    .run();
  // The address lives in the control plane, where Better Auth keeps it — the per-firm database has
  // no email column, so the pass has to cross to reach one.
  await env.DB_CONTROL.prepare(
    'INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, firm_id) VALUES (?1, ?2, ?3, 1, ?4, ?4, ?5)',
  )
    .bind(READER, "Digest Reader", READER_ADDRESS, Date.now(), firmId)
    .run();

  await firmDatabase
    .prepare(
      "INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at) VALUES (?1, ?2, 'active', 0, ?3)",
    )
    .bind(READER, "Digest Reader", TS)
    .run();
  matterId = newIdentifier("matter");
  await firmDatabase
    .prepare(
      "INSERT INTO matter (id, title, matter_number, status, responsible_member_id, e_billing, created_at, updated_at) VALUES (?1, ?2, ?3, 'open', ?4, 0, ?5, ?5)",
    )
    .bind(matterId, MATTER_TITLE, MATTER_NUMBER, READER, TS)
    .run();
  await firmDatabase.batch([
    writeNotificationDigestLocalHourStatement(firmDatabase, DIGEST_HOUR, TS),
  ]);

  await seedNotification("deadlines", "deadlines.deadline.overdue");
  await seedNotification("deadlines", "deadlines.deadline.due");
  await seedNotification("trust", "trust.ledger.entry.posted");
  await seedNotification("jobs", "jobs.documentAssembly.completed");
});

describe("the digest pass on the cron", () => {
  it("mails nobody at all while outbound mail is unprovisioned", async () => {
    // Each refusal is driven by taking one piece of provisioning away, rather than by whatever this
    // deployment happens to bind: once mail IS provisioned — production has a sending address and a
    // public origin today — a test that read the ambient bindings would silently stop asserting
    // anything. The honest answer is a reason, not a throw, and emphatically not the dev logging
    // adapter, which would have this pass record `sent` rows for mail printed to a log.
    const silentLogger = { log: () => undefined, count: () => undefined } as never;
    const unprovisioned = {
      SEND_EMAIL: "send-binding-not-configured",
      EMAIL_FROM: "sender-address-not-configured",
      APP_BASE_URL: "app-base-url-not-configured",
    } as const;
    for (const [binding, reason] of Object.entries(unprovisioned)) {
      const port = resolveNotificationDigestSendPort(
        { ...env, [binding]: undefined } as never,
        silentLogger,
      );
      expect(port).toEqual({ status: "unavailable", reason });
    }

    const firmsMailed = await runNotificationDigestPass(
      { ...env, EMAIL_FROM: undefined } as never,
      { now: AT_THE_HOUR },
    );

    expect(firmsMailed).toBe(0);
    expect(await deliveryStates()).toEqual([]);
    expect(await watermark()).toBeNull();
  });

  it("does nothing at an hour that is not the firm's", async () => {
    const sent: SentMessage[] = [];
    await runNotificationDigestPass(env, { now: OFF_THE_HOUR, port: recordingPort(sent) });

    expect(sent).toEqual([]);
    expect(await watermark()).toBeNull();
  });

  it("composes one summary at the firm's hour, carrying counts and nothing a person typed", async () => {
    const sent: SentMessage[] = [];
    await runNotificationDigestPass(env, { now: AT_THE_HOUR, port: recordingPort(sent) });

    // Other suites seed their own firms into the same control plane, so this run may have mailed
    // more than one member. Only this firm's reader is asserted about.
    const mine = sent.filter((message) => message.to === READER_ADDRESS);
    expect(mine).toHaveLength(1);
    const message = mine[0];

    // `jobs` defaults to `email: off`, so three of the four items count and the fourth is withheld.
    expect(message?.subject).toBe("Magna Carta — 3 items need your attention");
    expect(message?.messageClass).toBe("notification-digest");
    expect(message?.text).toContain("Deadlines 2 · Trust 1");
    expect(message?.text).toContain("https://app.example/notifications");

    const everything = `${message?.subject ?? ""}\n${message?.text ?? ""}`;
    for (const identifying of [MATTER_TITLE, MATTER_NUMBER, "Ellison", "Braddock", matterId]) {
      expect(everything, `a digest must never carry "${identifying}"`).not.toContain(identifying);
    }
  });

  it("settles what it sent AND what it withheld, and advances the mark once", async () => {
    const states = await deliveryStates();
    expect(states.filter((row) => row.state === "sent")).toHaveLength(3);
    // The `jobs` item: not mailed, and not an absence either — a member who chose not to hear about
    // a finished conversion stays distinguishable from a member nobody wrote to.
    expect(states.filter((row) => row.state === "suppressed")).toEqual([
      { state: "suppressed", suppressed_reason: "preference" },
    ]);
    expect((await watermark())?.last_event_id).toBe("notificationEvent_dg04");

    // A second pass in the same window has nothing left to say and writes nothing new.
    const sent: SentMessage[] = [];
    await runNotificationDigestPass(env, { now: AT_THE_HOUR, port: recordingPort(sent) });
    expect(sent.filter((message) => message.to === READER_ADDRESS)).toEqual([]);
    expect(await deliveryStates()).toHaveLength(4);
  });

  it("withholds the whole summary, with a reason, for a member who silenced every category", async () => {
    await firmDatabase.batch([
      writeMemberNotificationPreferencesStatement(
        firmDatabase,
        READER,
        { deadlines: { email: "off" }, trust: { email: "off" } },
        TS,
      ),
    ]);
    await seedNotification("deadlines", "deadlines.deadline.due");

    const sent: SentMessage[] = [];
    await runNotificationDigestPass(env, { now: AT_THE_HOUR, port: recordingPort(sent) });

    expect(sent.filter((message) => message.to === READER_ADDRESS)).toEqual([]);
    const states = await deliveryStates();
    expect(states).toHaveLength(5);
    expect(states.filter((row) => row.suppressed_reason === "preference")).toHaveLength(2);
  });
});
