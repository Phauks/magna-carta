import { env, SELF } from "cloudflare:test";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import {
  insertEmailMatterLinkStatement,
  insertEmailMessageStatement,
  insertEmailThreadStatement,
} from "@magna-carta/data-access/email-filing-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  EmailMatterLinkId,
  EmailMessageId,
  EmailThreadId,
  FirmId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

let firmId: FirmId;
let ownerUserId: UserId;
let ownerCookie: string;
let noPermCookie: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;
let matterId: MatterId;

const clock = { now: () => new Date().toISOString() };
const SIMPLE_EML = new TextEncoder().encode(
  "Message-ID: <r@example.test>\r\nFrom: a@example.test\r\nTo: b@example.test\r\nSubject: Hi\r\n\r\nBody.",
);

async function seedMatter(): Promise<MatterId> {
  const id = newIdentifier("matter");
  await firmDatabase
    .prepare(
      `INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at)
       VALUES (?1, 'M', 'open', ?2, 0, ?3, ?3)`,
    )
    .bind(id, ownerUserId, clock.now())
    .run();
  return id;
}

// Seed a captured message with a filed link on `matterId`, returning its ids.
async function seedFiledMessage(messageIdValue: string): Promise<EmailMessageId> {
  const threadId = newIdentifier("emailThread");
  const emailMessageId = newIdentifier("emailMessage");
  await firmDatabase.batch([
    insertEmailThreadStatement(
      firmDatabase,
      { id: threadId as EmailThreadId, subjectNormalized: "hi", firstSeenAt: clock.now() },
      clock.now(),
    ),
    insertEmailMessageStatement(
      firmDatabase,
      {
        id: emailMessageId,
        messageIdValue,
        messageIdProvenance: "header",
        subject: "Hi",
        sentAt: clock.now(),
        receivedAt: clock.now(),
        fromDisplay: null,
        fromAddress: "a@example.test",
        threadId: threadId as EmailThreadId,
        inReplyTo: null,
        contentSha256: `sha-${messageIdValue}`,
        dedupKey: `messageId:header:${messageIdValue}`,
        originalR2Key: `emails/${messageIdValue}/original`,
        referencesRemoteContent: false,
        integrity: "{}",
        dkimVerdict: "unverified",
        sourceFormat: "eml",
        capturedVia: "api",
      },
      clock.now(),
    ),
    insertEmailMatterLinkStatement(
      firmDatabase,
      {
        id: newIdentifier("emailMatterLink") as EmailMatterLinkId,
        emailMessageId,
        matterId,
        state: "filed",
        linkedBy: ownerUserId,
        linkedAt: clock.now(),
        capturedVia: "api",
      },
      clock.now(),
    ),
  ]);
  return emailMessageId;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Email Filing Routes Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("emails-routes-owner@example.com", {
    userName: "Owner",
    firmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Owner", firmId);
  ownerCookie = await signInForSessionCookie("emails-routes-owner@example.com");

  const noPerm = await seedCredentialedUser("emails-routes-noperm@example.com", {
    userName: "No Perm",
    firmId,
  });
  // A member with no roles → holds no emails:* permission.
  await insertMemberStatement(firmDatabase, {
    userId: noPerm.userId,
    displayName: "No Perm",
    now: clock.now(),
  }).run();
  noPermCookie = await signInForSessionCookie("emails-routes-noperm@example.com");

  matterId = await seedMatter();
});

describe("emails routes", () => {
  it("refuses capture to a caller without emails:file (403)", async () => {
    const res = await SELF.fetch(`https://x/api/v1/matters/${matterId}/emails`, {
      method: "POST",
      headers: { cookie: noPermCookie, "content-type": "application/octet-stream" },
      body: SIMPLE_EML,
    });
    expect(res.status).toBe(403);
  });

  it("accepts a capture and returns 202 with a job id", async () => {
    const res = await SELF.fetch(`https://x/api/v1/matters/${matterId}/emails`, {
      method: "POST",
      headers: { cookie: ownerCookie, "content-type": "application/octet-stream" },
      body: SIMPLE_EML,
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { jobId: string; status: string };
    expect(body.status).toBe("accepted");
    expect(typeof body.jobId).toBe("string");
  });

  it("lists a matter's filed emails", async () => {
    await seedFiledMessage("<list@example.test>");
    const res = await SELF.fetch(`https://x/api/v1/matters/${matterId}/emails`, {
      headers: { cookie: ownerCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { fromAddress: string | null }[] };
    expect(body.data.length).toBeGreaterThan(0);
  });

  it("the already-filed signal reports captured + the accessible matter, or not-captured", async () => {
    await seedFiledMessage("<filed@example.test>");
    const hit = await SELF.fetch(
      "https://x/api/v1/emails/already-filed?messageId=%3Cfiled@example.test%3E",
      { headers: { cookie: ownerCookie } },
    );
    expect(hit.status).toBe(200);
    const body = (await hit.json()) as {
      captured: boolean;
      matters: string[];
      totalMatterCount: number;
    };
    expect(body.captured).toBe(true);
    expect(body.matters).toContain(matterId);
    expect(body.totalMatterCount).toBe(1);

    const miss = await SELF.fetch(
      "https://x/api/v1/emails/already-filed?messageId=%3Cnope@example.test%3E",
      { headers: { cookie: ownerCookie } },
    );
    const missBody = (await miss.json()) as { captured: boolean };
    expect(missBody.captured).toBe(false);
  });

  it("unlinks an email from a matter without deleting the message", async () => {
    const emailMessageId = await seedFiledMessage("<unlink@example.test>");
    const res = await SELF.fetch(`https://x/api/v1/matters/${matterId}/emails/${emailMessageId}`, {
      method: "DELETE",
      headers: { cookie: ownerCookie },
    });
    expect(res.status).toBe(200);
    // The message row still exists (unlink ≠ delete).
    const still = await firmDatabase
      .prepare("SELECT id FROM email_message WHERE id = ?1")
      .bind(emailMessageId)
      .all<{ id: string }>();
    expect(still.results).toHaveLength(1);
  });
});
