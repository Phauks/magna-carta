import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  filedMatterIdsForMessage,
  findByDedupKey,
  readMatterEmails,
} from "@magna-carta/data-access/email-filing-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, MatterId, UserId } from "@magna-carta/identifiers/types";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { handleCaptureMessage, type EmailsCaptureMessage } from "../src/emails/capture-consumer.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { mirrorMemberWithOwnerRole, seedCredentialedUser, seedFirm } from "./support/test-auth.ts";

// Fixtures inlined (the Miniflare/workerd pool has no host filesystem). Mirror the email-core corpus.
const SIMPLE_EML = `Message-ID: <first@example.test>
From: Alice Attorney <alice@example.test>
To: Bob Client <bob@example.test>
Subject: Retainer
Date: Tue, 07 Jul 2026 10:00:00 -0700
DKIM-Signature: v=1; a=rsa-sha256; d=example.test; s=sel; b=AAAA
Content-Type: text/plain; charset=utf-8

The retainer is attached.`;

const WITH_ATTACHMENT_EML = `Message-ID: <second@example.test>
From: Alice Attorney <alice@example.test>
To: Bob Client <bob@example.test>
Subject: Retainer with attachment
Date: Tue, 07 Jul 2026 10:05:00 -0700
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="boundary42"

--boundary42
Content-Type: text/plain; charset=utf-8

Please see the attached engagement letter.

--boundary42
Content-Type: application/pdf; name="engagement-letter.pdf"
Content-Disposition: attachment; filename="engagement-letter.pdf"
Content-Transfer-Encoding: base64

JVBERi0xLjQKJeLjz9MK

--boundary42--
`;

const FIXTURES: Record<string, string> = {
  "simple.eml": SIMPLE_EML,
  "with-attachment.eml": WITH_ATTACHMENT_EML,
};

function fixture(name: string): Uint8Array {
  return new TextEncoder().encode(FIXTURES[name]);
}

let firmId: FirmId;
let ownerUserId: UserId;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;
let matterOne: MatterId;
let matterTwo: MatterId;

const clock = { now: () => new Date().toISOString() };

async function seedMatter(): Promise<MatterId> {
  const matterId = newIdentifier("matter");
  await firmDatabase
    .prepare(
      `INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at)
       VALUES (?1, 'Test Matter', 'open', ?2, 0, ?3, ?3)`,
    )
    .bind(matterId, ownerUserId, clock.now())
    .run();
  return matterId;
}

// Stage raw bytes to R2 and run the capture consumer, as the route/Email Worker would.
async function capture(
  bytes: Uint8Array,
  overrides: Partial<EmailsCaptureMessage> = {},
): Promise<void> {
  const jobId = newIdentifier("idempotencyRecord");
  const stagedR2Key = `emails/staging/${jobId}`;
  await env.R2.put(stagedR2Key, bytes);
  await handleCaptureMessage(env, {
    firmId,
    bucketName: "test-bucket",
    stagedR2Key,
    capturedVia: "api",
    matterId: matterOne,
    captureToken: null,
    linkedBy: ownerUserId,
    acceptOnCapture: true,
    jobId,
    ...overrides,
  });
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Email Filing Capture Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
  const owner = await seedCredentialedUser("emails-capture-owner@example.com", {
    userName: "Capture Owner",
    firmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Capture Owner", firmId);
  matterOne = await seedMatter();
  matterTwo = await seedMatter();
});

describe("email capture consumer", () => {
  it("captures an .eml into a message, participants, and a filed link the matter view shows", async () => {
    await capture(fixture("simple.eml"), { matterId: matterOne });

    const message = await firmDatabase
      .prepare("SELECT id, dedup_key, dkim_verdict, original_r2_key FROM email_message LIMIT 1")
      .all<{ id: string; dedup_key: string; dkim_verdict: string; original_r2_key: string }>();
    expect(message.results).toHaveLength(1);
    expect(message.results[0]?.dkim_verdict).toBe("unverified");
    expect(message.results[0]?.original_r2_key.startsWith("emails/")).toBe(true);

    const participants = await firmDatabase
      .prepare("SELECT COUNT(*) AS n FROM email_participant")
      .all<{ n: number }>();
    expect(participants.results[0]?.n ?? 0).toBeGreaterThan(0);

    const page = await readMatterEmails(firmDatabase, matterOne, undefined);
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.linkState).toBe("filed");

    // The verbatim original landed in R2 under its content-addressed key.
    const original = await env.R2.get(message.results[0]!.original_r2_key);
    expect(original).not.toBe(null);
  });

  it("dedupes a re-capture of the same message and links it to a second matter (one record, two links)", async () => {
    const before = await firmDatabase
      .prepare("SELECT COUNT(*) AS n FROM email_message")
      .all<{ n: number }>();
    await capture(fixture("simple.eml"), { matterId: matterTwo });
    const after = await firmDatabase
      .prepare("SELECT COUNT(*) AS n FROM email_message")
      .all<{ n: number }>();
    expect(after.results[0]?.n).toBe(before.results[0]?.n); // no second message

    const hit = await firmDatabase
      .prepare("SELECT id FROM email_message LIMIT 1")
      .all<{ id: string }>();
    const filed = await filedMatterIdsForMessage(firmDatabase, hit.results[0]!.id as never);
    expect(filed).toContain(matterOne);
    expect(filed).toContain(matterTwo); // now on two matters
  });

  it("extracts a real attachment into a File Manager document and records the link", async () => {
    const matter = await seedMatter();
    await capture(fixture("with-attachment.eml"), { matterId: matter });

    const attachment = await firmDatabase
      .prepare(
        "SELECT file_id, outcome, disposition FROM email_attachment WHERE outcome = 'extracted' LIMIT 1",
      )
      .all<{ file_id: string | null; outcome: string; disposition: string }>();
    expect(attachment.results.length).toBeGreaterThan(0);
    expect(attachment.results[0]?.file_id).not.toBe(null);

    // A first-class File Manager file was staged for the extracted document (pending until ingest runs).
    const file = await firmDatabase
      .prepare("SELECT id, matter_id FROM file WHERE id = ?1")
      .bind(attachment.results[0]!.file_id)
      .all<{ id: string; matter_id: string }>();
    expect(file.results[0]?.matter_id).toBe(matter);
  });

  // The notification's emission point on the capture path, and the reason it is an outbox row rather
  // than a call: it commits with the link, so it exists exactly when the filing does. A re-capture of
  // a message this matter already holds inserts nothing (the link insert is ON CONFLICT DO NOTHING),
  // and telling the matter's team the email just arrived a second time would be false.
  it("commits one email.filed topic per filing and none for a re-capture onto the same matter", async () => {
    const matter = await seedMatter();
    const filedTopics = async (): Promise<{ payload: string }[]> => {
      const { results } = await firmDatabase
        .prepare("SELECT payload FROM outbox WHERE topic = 'email.filed' AND payload LIKE ?1")
        .bind(`%${matter}%`)
        .all<{ payload: string }>();
      return results;
    };

    await capture(fixture("simple.eml"), { matterId: matter });
    const first = await filedTopics();
    expect(first).toHaveLength(1);
    const message = await firmDatabase
      .prepare("SELECT id FROM email_message LIMIT 1")
      .all<{ id: string }>();
    // Identifiers only — no subject, no address, no participant list crosses the bus.
    expect(JSON.parse(first[0]?.payload ?? "{}")).toEqual({
      emailMessageId: message.results[0]?.id,
      matterId: matter,
    });

    await capture(fixture("simple.eml"), { matterId: matter });
    expect(await filedTopics()).toHaveLength(1);
  });

  it("a dedup re-capture does not re-extract attachments (idempotent)", async () => {
    const matter = await seedMatter();
    await capture(fixture("with-attachment.eml"), {
      matterId: matter,
      jobId: newIdentifier("idempotencyRecord"),
    });
    const first = await firmDatabase
      .prepare("SELECT COUNT(*) AS n FROM email_attachment")
      .all<{ n: number }>();
    await capture(fixture("with-attachment.eml"), {
      matterId: matter,
      jobId: newIdentifier("idempotencyRecord"),
    });
    const second = await firmDatabase
      .prepare("SELECT COUNT(*) AS n FROM email_attachment")
      .all<{ n: number }>();
    expect(second.results[0]?.n).toBe(first.results[0]?.n); // no duplicate attachment rows
  });
});
