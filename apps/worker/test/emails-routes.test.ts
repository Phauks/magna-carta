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
async function seedFiledMessage(
  messageIdValue: string,
  verdict: {
    dkimVerdict: "unverified" | "pass" | "fail";
    dkimVerdictReason: string | null;
    dkimVerifiedDomain: string | null;
  } = { dkimVerdict: "unverified", dkimVerdictReason: null, dkimVerifiedDomain: null },
): Promise<EmailMessageId> {
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
        ...verdict,
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

// Post bytes to the capture endpoint. The Idempotency-Key is optional here (the route honours it
// itself rather than through the chokepoint gate, which would consume the binary body), so it is only
// sent when a test is about the key.
function postCapture(
  body: BodyInit,
  options: { cookie: string; key?: string; source?: string } = { cookie: "" },
): Promise<Response> {
  const query = options.source === undefined ? "" : `?source=${options.source}`;
  return SELF.fetch(`https://x/api/v1/matters/${matterId}/emails${query}`, {
    method: "POST",
    headers: {
      cookie: options.cookie,
      "content-type": "application/octet-stream",
      ...(options.key === undefined ? {} : { "idempotency-key": options.key }),
    },
    body,
  });
}

describe("emails routes", () => {
  it("refuses capture to a caller without emails:file (403)", async () => {
    const res = await postCapture(SIMPLE_EML, { cookie: noPermCookie });
    expect(res.status).toBe(403);
  });

  // Also covers the declared capture source: the add-in names itself so a capture that preserved the
  // original message is distinguishable from a manual upload. (Folded into one request rather than
  // asserted separately — this route's rate-limit bucket is deliberately small, and a test file that
  // spends it starts failing on the limit instead of on the behaviour.)
  it("accepts a capture, declaring its source, and returns 202 with a job id", async () => {
    const res = await postCapture(SIMPLE_EML, { cookie: ownerCookie, source: "addin" });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { jobId: string; status: string };
    expect(body.status).toBe("accepted");
    expect(typeof body.jobId).toBe("string");
  });

  // The add-in files over whatever network the user's mail client is on and is expected to retry. A
  // retry must converge on the capture it already started, not start a second one.
  it("replays a retried capture onto the same job rather than staging a second one", async () => {
    const key = crypto.randomUUID();
    const first = await postCapture(SIMPLE_EML, { cookie: ownerCookie, key });
    const second = await postCapture(SIMPLE_EML, { cookie: ownerCookie, key });
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    const firstBody = (await first.json()) as { jobId: string };
    const secondBody = (await second.json()) as { jobId: string };
    expect(secondBody.jobId).toBe(firstBody.jobId);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
  });

  // The key is fingerprinted against the bytes actually received, so reusing one for a different
  // message is caught rather than silently answered with the first capture.
  it("refuses an Idempotency-Key reused with different bytes (422)", async () => {
    const key = crypto.randomUUID();
    const first = await postCapture(SIMPLE_EML, { cookie: ownerCookie, key });
    expect(first.status).toBe(202);
    const second = await postCapture(
      new TextEncoder().encode(
        "Message-ID: <other@example.test>\r\nFrom: a@example.test\r\n\r\nX.",
      ),
      { cookie: ownerCookie, key },
    );
    expect(second.status).toBe(422);
  });

  // A payload that is not mail is refused at the door. Accepting it would stage bytes and leave the
  // capture consumer to fail on them, where the only outcomes are a retry loop and a dead letter.
  it("refuses a payload that is not an email message (422)", async () => {
    const res = await postCapture(new TextEncoder().encode("%PDF-1.7\nnot mail at all\n"), {
      cookie: ownerCookie,
    });
    expect(res.status).toBe(422);
  });

  it("refuses an empty body (400)", async () => {
    const res = await postCapture(new Uint8Array(), { cookie: ownerCookie });
    expect(res.status).toBe(400);
  });

  // Existence and access answer identically, so the endpoint cannot be used to probe for a matter the
  // caller is walled from.
  it("answers a matter it cannot resolve as absence (404)", async () => {
    const unknown = newIdentifier("matter");
    const res = await SELF.fetch(`https://x/api/v1/matters/${unknown}/emails`, {
      method: "POST",
      headers: {
        cookie: ownerCookie,
        "content-type": "application/octet-stream",
        "idempotency-key": crypto.randomUUID(),
      },
      body: SIMPLE_EML,
    });
    expect(res.status).toBe(404);
  });

  // `forward` belongs to the Email Worker and `sync` to the credentialed adapter; neither could be
  // claimed honestly by an API caller, so the enum admits only the two entrances that post here.
  it("refuses a capture source that is not an API entrance (422)", async () => {
    const res = await postCapture(SIMPLE_EML, { cookie: ownerCookie, source: "forward" });
    expect(res.status).toBe(422);
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

  // The verdict rides the message read so a reader can weigh it. It is informational — the message is
  // filed and readable whatever it says.
  it("returns the signature verdict, its reason, and the domain a pass names", async () => {
    const emailMessageId = await seedFiledMessage("<signed@example.test>", {
      dkimVerdict: "pass",
      dkimVerdictReason: "passed",
      dkimVerifiedDomain: "example.test",
    });
    const res = await SELF.fetch(`https://x/api/v1/emails/${emailMessageId}`, {
      headers: { cookie: ownerCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dkimVerdict: string;
      dkimVerdictReason: string | null;
      dkimVerifiedDomain: string | null;
    };
    expect(body.dkimVerdict).toBe("pass");
    expect(body.dkimVerdictReason).toBe("passed");
    expect(body.dkimVerifiedDomain).toBe("example.test");
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
