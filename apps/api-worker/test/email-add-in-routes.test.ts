import { env, SELF } from "cloudflare:test";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import {
  captureIdempotencyKey,
  insertEmailCaptureAddressStatement,
  insertEmailMatterLinkStatement,
  insertEmailMessageStatement,
  insertEmailThreadStatement,
} from "@magna-carta/data-access/email-filing-statements";
import { insertCompletedIdempotencyRecordStatement } from "@magna-carta/data-access/idempotency-statements";
import { addEmail } from "@magna-carta/directory/contact-email";
import { createPerson } from "@magna-carta/directory/person";
import { linkMatterParty } from "@magna-carta/directory/party";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  EmailCaptureAddressId,
  EmailMatterLinkId,
  EmailMessageId,
  EmailThreadId,
  FirmId,
  IdempotencyRecordId,
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

// The mail-client add-in surface: matter suggestions, capture status, and the member's filing
// context. The add-in's own UI is built separately; these are the reads it runs against.

let firmId: FirmId;
let ownerUserId: UserId;
let ownerCookie: string;
let noPermCookie: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

// The matter the thread signal proposes, the one the subject number proposes, and the one the
// correspondent proposes — kept apart so each signal is observed on its own.
let threadMatterId: MatterId;
let numberedMatterId: MatterId;
let partyMatterId: MatterId;
let threadId: EmailThreadId;

const clock = { now: () => "2026-08-05T12:00:00.000Z" };
const MATTER_NUMBER = "2026-0042";
const PARTY_ADDRESS = "counsel@opposing.example";

async function seedMatter(title: string, matterNumber: string | null): Promise<MatterId> {
  const id = newIdentifier("matter");
  await firmDatabase
    .prepare(
      `INSERT INTO matter (id, title, status, responsible_member_id, matter_number, e_billing, created_at, updated_at)
       VALUES (?1, ?2, 'open', ?3, ?4, 0, ?5, ?5)`,
    )
    .bind(id, title, ownerUserId, matterNumber, clock.now())
    .run();
  return id;
}

// One captured message on its own thread, filed to `matterId` by the owner.
async function seedFiledMessage(matterId: MatterId, at: string): Promise<EmailMessageId> {
  const emailMessageId = newIdentifier("emailMessage");
  await firmDatabase.batch([
    insertEmailMessageStatement(
      firmDatabase,
      {
        id: emailMessageId,
        messageIdValue: `<${emailMessageId}@example.test>`,
        messageIdProvenance: "header",
        subject: "Filed already",
        sentAt: at,
        receivedAt: at,
        fromDisplay: null,
        fromAddress: "a@example.test",
        threadId,
        inReplyTo: null,
        contentSha256: `sha-${emailMessageId}`,
        dedupKey: `messageId:header:<${emailMessageId}@example.test>`,
        originalR2Key: `emails/${emailMessageId}/original`,
        referencesRemoteContent: false,
        integrity: "{}",
        dkimVerdict: "unverified",
        dkimVerdictReason: null,
        dkimVerifiedDomain: null,
        sourceFormat: "eml",
        capturedVia: "addin",
      },
      at,
    ),
    insertEmailMatterLinkStatement(
      firmDatabase,
      {
        id: newIdentifier("emailMatterLink") as EmailMatterLinkId,
        emailMessageId,
        matterId,
        state: "filed",
        linkedBy: ownerUserId,
        linkedAt: at,
        capturedVia: "addin",
      },
      at,
    ),
  ]);
  return emailMessageId;
}

let threadAnchorMessageIdValue: string;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Email Add-In Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("email-add-in-owner@example.com", {
    userName: "Owner",
    firmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Owner", firmId);
  ownerCookie = await signInForSessionCookie("email-add-in-owner@example.com");

  const noPerm = await seedCredentialedUser("email-add-in-noperm@example.com", {
    userName: "No Perm",
    firmId,
  });
  // A member with no roles holds no emails:* capability.
  await insertMemberStatement(firmDatabase, {
    userId: noPerm.userId,
    displayName: "No Perm",
    now: clock.now(),
  }).run();
  noPermCookie = await signInForSessionCookie("email-add-in-noperm@example.com");

  threadMatterId = await seedMatter("Thread Matter", null);
  numberedMatterId = await seedMatter("Numbered Matter", MATTER_NUMBER);
  partyMatterId = await seedMatter("Party Matter", null);

  threadId = newIdentifier("emailThread") as EmailThreadId;
  await firmDatabase.batch([
    insertEmailThreadStatement(
      firmDatabase,
      { id: threadId, subjectNormalized: "filed already", firstSeenAt: clock.now() },
      clock.now(),
    ),
  ]);
  const anchor = await seedFiledMessage(threadMatterId, "2026-08-01T09:00:00.000Z");
  threadAnchorMessageIdValue = `<${anchor}@example.test>`;

  // The correspondent signal: an address in the Directory, whose entity is a party on a matter.
  const writeOptions = { clock, actorUserId: ownerUserId };
  const personId = await createPerson(
    firmDatabase,
    { given: "Opposing", family: "Counsel" },
    writeOptions,
  );
  await addEmail(firmDatabase, { entityId: personId, address: PARTY_ADDRESS }, writeOptions);
  await linkMatterParty(
    firmDatabase,
    { matterId: partyMatterId, entityId: personId, role: "opposing_party" },
    writeOptions,
  );

  // A live capture address on one matter, so the filing context can report the door exists.
  await firmDatabase.batch([
    insertEmailCaptureAddressStatement(
      firmDatabase,
      {
        id: newIdentifier("emailCaptureAddress") as EmailCaptureAddressId,
        token: "abcd1234efgh5678",
        kind: "matter",
        matterId: threadMatterId,
        createdBy: ownerUserId,
      },
      clock.now(),
    ),
  ]);
});

interface SuggestionBody {
  data: {
    matterId: string;
    matterNumber: string | null;
    title: string;
    confidence: string;
    score: number;
    signals: string[];
    reasons: string[];
  }[];
  ambiguous: boolean;
}

function suggest(body: unknown, cookie: string): Promise<Response> {
  return SELF.fetch("https://x/api/v1/emails/matter-suggestions", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("matter suggestions", () => {
  it("refuses a caller without emails:read (403)", async () => {
    const res = await suggest({ subject: "anything" }, noPermCookie);
    expect(res.status).toBe(403);
  });

  it("returns nothing when no signal fires", async () => {
    const res = await suggest({ subject: "Lunch?" }, ownerCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as SuggestionBody;
    expect(body.data).toEqual([]);
    expect(body.ambiguous).toBe(false);
  });

  it("proposes the matter a conversation is already filed to, with high confidence", async () => {
    const res = await suggest({ inReplyTo: threadAnchorMessageIdValue }, ownerCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as SuggestionBody;
    expect(body.data[0]?.matterId).toBe(threadMatterId);
    expect(body.data[0]?.signals).toContain("threadContinuation");
    expect(body.data[0]?.confidence).toBe("high");
    expect(body.data[0]?.reasons[0]).toContain("already filed");
  });

  it("proposes the matter whose number appears in the subject line", async () => {
    const res = await suggest({ subject: `Re: [${MATTER_NUMBER}] Discovery` }, ownerCookie);
    const body = (await res.json()) as SuggestionBody;
    expect(body.data[0]?.matterId).toBe(numberedMatterId);
    expect(body.data[0]?.matterNumber).toBe(MATTER_NUMBER);
    expect(body.data[0]?.signals).toEqual(["subjectMatterNumber"]);
  });

  it("proposes the matter a correspondent is a party on, naming who tied them together", async () => {
    const res = await suggest({ participants: [`  ${PARTY_ADDRESS.toUpperCase()} `] }, ownerCookie);
    const body = (await res.json()) as SuggestionBody;
    expect(body.data[0]?.matterId).toBe(partyMatterId);
    expect(body.data[0]?.reasons[0]).toContain(PARTY_ADDRESS);
    expect(body.data[0]?.reasons[0]).toContain("opposing_party");
  });

  it("ranks a filed conversation above a subject number above a correspondent, and flags no tie", async () => {
    const res = await suggest(
      {
        inReplyTo: threadAnchorMessageIdValue,
        subject: `Re: [${MATTER_NUMBER}] Discovery`,
        participants: [PARTY_ADDRESS],
      },
      ownerCookie,
    );
    const body = (await res.json()) as SuggestionBody;
    expect(body.data.map((item) => item.matterId)).toEqual([
      threadMatterId,
      numberedMatterId,
      partyMatterId,
    ]);
    expect(body.ambiguous).toBe(false);
  });

  it("delegates a typed term to the same free-text matter search the caseload list uses", async () => {
    const res = await suggest({ query: "Numbered" }, ownerCookie);
    const body = (await res.json()) as SuggestionBody;
    expect(body.data.map((item) => item.matterId)).toContain(numberedMatterId);
    expect(body.data[0]?.signals).toEqual(["searchTerm"]);
  });

  it("honours the caller's limit", async () => {
    const res = await suggest(
      {
        inReplyTo: threadAnchorMessageIdValue,
        subject: `Re: [${MATTER_NUMBER}] Discovery`,
        limit: 1,
      },
      ownerCookie,
    );
    const body = (await res.json()) as SuggestionBody;
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.matterId).toBe(threadMatterId);
  });
});

interface CaptureStatusBody {
  captureJobId: string;
  status: string;
  emailMessageId: string | null;
  matterId: string | null;
  linkState: string;
  deduplicated: boolean;
}

describe("capture status", () => {
  it("refuses a caller without emails:read (403)", async () => {
    const res = await SELF.fetch("https://x/api/v1/emails/captures/whatever", {
      headers: { cookie: noPermCookie },
    });
    expect(res.status).toBe(403);
  });

  it("reads a job nobody has finished as pending rather than as missing", async () => {
    const res = await SELF.fetch("https://x/api/v1/emails/captures/nosuchjob", {
      headers: { cookie: ownerCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CaptureStatusBody;
    expect(body.status).toBe("pending");
    expect(body.emailMessageId).toBe(null);
    expect(body.linkState).toBe("none");
  });

  it("reports what the capture consumer recorded once the job has landed", async () => {
    const jobId = "job-landed-0001";
    const emailMessageId = newIdentifier("emailMessage");
    await firmDatabase.batch([
      insertCompletedIdempotencyRecordStatement(firmDatabase, {
        id: newIdentifier("idempotencyRecord") as IdempotencyRecordId,
        key: captureIdempotencyKey(jobId),
        fingerprint: jobId,
        responseCode: 200,
        responseBody: JSON.stringify({
          emailMessageId,
          threadId,
          matterId: threadMatterId,
          linkState: "filed",
          deduplicated: true,
        }),
        createdAt: clock.now(),
      }),
    ]);
    const res = await SELF.fetch(`https://x/api/v1/emails/captures/${jobId}`, {
      headers: { cookie: ownerCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CaptureStatusBody;
    expect(body).toEqual({
      captureJobId: jobId,
      status: "completed",
      emailMessageId,
      matterId: threadMatterId,
      linkState: "filed",
      deduplicated: true,
    });
  });
});

interface FilingContextBody {
  recentMatters: {
    matterId: string;
    title: string;
    lastFiledAt: string;
    filedCount: number;
    captureAddressAvailable: boolean;
    captureAddressPreview: string | null;
  }[];
  firmCaptureAddress: { available: boolean; tokenPreview: string | null; createdAt: string | null };
  captureRootDomain: string;
  maxMessageBytes: number;
}

describe("filing context", () => {
  it("refuses a caller without emails:read (403)", async () => {
    const res = await SELF.fetch("https://x/api/v1/emails/filing-context", {
      headers: { cookie: noPermCookie },
    });
    expect(res.status).toBe(403);
  });

  it("reports the member's own recent filing targets, newest first", async () => {
    await seedFiledMessage(numberedMatterId, "2026-08-04T09:00:00.000Z");
    const res = await SELF.fetch("https://x/api/v1/emails/filing-context", {
      headers: { cookie: ownerCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as FilingContextBody;
    expect(body.recentMatters.map((item) => item.matterId)).toEqual([
      numberedMatterId,
      threadMatterId,
    ]);
    expect(body.recentMatters[1]?.title).toBe("Thread Matter");
  });

  it("says a matter has a capture address without ever returning the token", async () => {
    const res = await SELF.fetch("https://x/api/v1/emails/filing-context", {
      headers: { cookie: ownerCookie },
    });
    const body = (await res.json()) as FilingContextBody;
    const withAddress = body.recentMatters.find((item) => item.matterId === threadMatterId);
    const withoutAddress = body.recentMatters.find((item) => item.matterId === numberedMatterId);
    expect(withAddress?.captureAddressAvailable).toBe(true);
    expect(withAddress?.captureAddressPreview).toBe("abcd...");
    expect(withoutAddress?.captureAddressAvailable).toBe(false);
    // The whole token appears nowhere in the response.
    expect(JSON.stringify(body)).not.toContain("abcd1234efgh5678");
  });

  it("reports the capture zone and the size ceiling a message must fit under", async () => {
    const res = await SELF.fetch("https://x/api/v1/emails/filing-context", {
      headers: { cookie: ownerCookie },
    });
    const body = (await res.json()) as FilingContextBody;
    expect(body.captureRootDomain.length).toBeGreaterThan(0);
    expect(body.maxMessageBytes).toBeGreaterThan(0);
    expect(body.firmCaptureAddress.available).toBe(false);
  });

  it("honours the caller's limit", async () => {
    const res = await SELF.fetch("https://x/api/v1/emails/filing-context?limit=1", {
      headers: { cookie: ownerCookie },
    });
    const body = (await res.json()) as FilingContextBody;
    expect(body.recentMatters).toHaveLength(1);
  });
});
