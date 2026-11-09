import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
} from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type { EmailMessageId, FirmId, MatterId, UserId } from "@magna-carta/identifiers/types";
import { problemType } from "../src/http/contracts/problem-types.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { handleCaptureMessage } from "../src/background/emails/capture-consumer.ts";
import type { EmailsCaptureMessage } from "../src/emails/capture-types.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  readJson,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The management surface, exercised end to end: a member creates a rule from a filing they made, mail
// arrives afterwards and lands where the rule said, and the firm can see what the rule has been doing
// and stop it. Before these routes existed the engine ran on every capture and could never match
// anything, because nothing in the product could produce a rule for it to match.
//
// The tests below are written against PROPERTIES rather than against the handlers: each one names a
// refusal or a consequence that would be a real product failure if it stopped holding, and several were
// checked by removing the code that provides them and watching the test fail.

let firmId: FirmId;
let ownerUserId: UserId;
let ownerCookie: string;
// A Paralegal: emails:read and emails:manageLinks, but NOT emails:manageAutoFileRules. The whole point
// of the separate capability is that this member may file mail and may not configure the machine to.
let paralegalCookie: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const clock = { now: () => new Date().toISOString() };

function messageBytes(options: {
  messageId: string;
  from: string;
  subject: string;
  inReplyTo?: string;
}): Uint8Array {
  return new TextEncoder().encode(
    [
      `Message-ID: <${options.messageId}>`,
      `From: ${options.from}`,
      "To: Alice Attorney <alice@firm.test>",
      `Subject: ${options.subject}`,
      "Date: Tue, 07 Jul 2026 10:00:00 -0700",
      ...(options.inReplyTo === undefined ? [] : [`In-Reply-To: <${options.inReplyTo}>`]),
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Body text that must never reach a rule row, a ledger row, or an audit row.",
    ].join("\r\n"),
  );
}

let matterCounter = 0;
async function seedMatter(status: "open" | "closed" = "open"): Promise<MatterId> {
  matterCounter += 1;
  const matterId = newIdentifier("matter");
  await firmDatabase
    .prepare(
      `INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)`,
    )
    .bind(matterId, `Rule Matter ${matterCounter}`, status, ownerUserId, clock.now())
    .run();
  return matterId;
}

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
    capturedVia: "forward",
    matterId: null,
    captureToken: null,
    linkedBy: null,
    acceptOnCapture: false,
    jobId,
    ...overrides,
  });
}

async function messageIdFor(headerValue: string): Promise<EmailMessageId> {
  const { results } = await firmDatabase
    .prepare("SELECT id FROM email_message WHERE message_id_value = ?1")
    .bind(headerValue)
    .all<{ id: string }>();
  const found = results[0]?.id;
  if (found === undefined) throw new Error(`no captured message for ${headerValue}`);
  return found as EmailMessageId;
}

interface LinkRow {
  matter_id: string;
  state: string;
  auto_file_rule_id: string | null;
}

async function linksFor(emailMessageId: string): Promise<LinkRow[]> {
  const { results } = await firmDatabase
    .prepare(
      "SELECT matter_id, state, auto_file_rule_id FROM email_matter_link WHERE email_message_id = ?1 ORDER BY created_at ASC, id ASC",
    )
    .bind(emailMessageId)
    .all<LinkRow>();
  return results;
}

// File an original onto the matter by hand, exactly as a member would, and hand back both the message
// the rule will be learned from and the thread a later reply joins.
let conversationCounter = 0;
async function fileConversationByHand(
  matterId: MatterId,
): Promise<{ originalHeaderId: string; originalMessageId: EmailMessageId }> {
  conversationCounter += 1;
  const originalHeaderId = `rules-original-${conversationCounter}@example.test`;
  await capture(
    messageBytes({
      messageId: originalHeaderId,
      from: "Opposing Counsel <Counsel@Opposing.TEST>",
      subject: `Retainer ${conversationCounter}`,
    }),
    { matterId, capturedVia: "api", acceptOnCapture: true, linkedBy: ownerUserId },
  );
  return { originalHeaderId, originalMessageId: await messageIdFor(originalHeaderId) };
}

function writeHeaders(cookie: string): Record<string, string> {
  return {
    cookie,
    "content-type": "application/json",
    "idempotency-key": newIdentifier("idempotencyRecord"),
  };
}

interface RuleBody {
  emailAutoFileRuleId: string;
  kind: string;
  matterId: string;
  matchValue: string;
  promotion: string;
  effectivePromotion: string;
  state: string;
  suspendedReason: string | null;
  createdBy: string | null;
  createdFromEmailMessageId: string | null;
  createdAt: string;
}

async function createRuleRequest(
  matterId: MatterId,
  body: Record<string, unknown>,
  cookie = ownerCookie,
): Promise<Response> {
  return SELF.fetch(`https://x/api/v1/matters/${matterId}/auto-file-rules`, {
    method: "POST",
    headers: writeHeaders(cookie),
    body: JSON.stringify(body),
  });
}

async function ruleRowCount(matterId: MatterId): Promise<number> {
  const { results } = await firmDatabase
    .prepare("SELECT COUNT(*) AS count FROM email_auto_file_rule WHERE matter_id = ?1")
    .bind(matterId)
    .all<{ count: number }>();
  return results[0]?.count ?? 0;
}

async function setDirectFilingPermitted(permitted: boolean): Promise<void> {
  await firmDatabase
    .prepare(
      `INSERT INTO setting (key, value, updated_at) VALUES ('emails.auto_file_direct_filing_permitted', ?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(JSON.stringify(permitted), clock.now())
    .run();
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Rule Surface Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("rule-surface-owner@example.com", {
    userName: "Rule Surface Owner",
    firmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Rule Surface Owner", firmId);
  ownerCookie = await signInForSessionCookie("rule-surface-owner@example.com");

  const paralegal = await seedCredentialedUser("rule-surface-paralegal@example.com", {
    userName: "Rule Surface Paralegal",
    firmId,
  });
  const paralegalRole = await firmDatabase
    .prepare("SELECT id FROM role WHERE name = 'Paralegal'")
    .all<{ id: string }>();
  const paralegalRoleId = paralegalRole.results[0]?.id;
  if (paralegalRoleId === undefined) throw new Error("seeded Paralegal role missing");
  await insertMemberStatement(firmDatabase, {
    userId: paralegal.userId,
    displayName: "Rule Surface Paralegal",
    now: clock.now(),
  }).run();
  await insertRoleAssignmentStatement(firmDatabase, {
    id: newIdentifier("memberRole"),
    memberUserId: paralegal.userId,
    roleId: assertIdentifier(paralegalRoleId, "role"),
  }).run();
  paralegalCookie = await signInForSessionCookie("rule-surface-paralegal@example.com");
});

beforeEach(async () => {
  await firmDatabase.prepare("UPDATE email_matter_link SET auto_file_rule_id = NULL").run();
  await firmDatabase.prepare("DELETE FROM email_auto_file_decision").run();
  await firmDatabase.prepare("DELETE FROM email_auto_file_rule").run();
  await setDirectFilingPermitted(false);
});

describe("creating an auto-file rule from a filing", () => {
  // The whole point of the surface, proved by the consequence rather than by the response body: a rule
  // that cannot be created is a mechanism that does not exist, and a rule created but never consulted
  // is the same thing with extra rows.
  it("makes a rule that actually files the next message in the conversation", async () => {
    const matterId = await seedMatter();
    const { originalHeaderId, originalMessageId } = await fileConversationByHand(matterId);

    const created = await createRuleRequest(matterId, {
      kind: "threadContinuation",
      createdFromEmailMessageId: originalMessageId,
    });
    expect(created.status).toBe(201);
    const rule = (await created.json()) as RuleBody;
    expect(rule).toMatchObject({
      kind: "threadContinuation",
      matterId,
      promotion: "stage",
      state: "active",
      createdBy: ownerUserId,
      createdFromEmailMessageId: originalMessageId,
    });

    // Mail arriving AFTER the rule, on the firm catch-all with no matter of its own.
    const replyHeaderId = "rules-reply-fires@example.test";
    await capture(
      messageBytes({
        messageId: replyHeaderId,
        from: "Opposing Counsel <counsel@opposing.test>",
        subject: "Re: Retainer",
        inReplyTo: originalHeaderId,
      }),
    );
    const replyId = await messageIdFor(replyHeaderId);
    expect(await linksFor(replyId)).toEqual([
      { matter_id: matterId, state: "staged", auto_file_rule_id: rule.emailAutoFileRuleId },
    ]);
  });

  // The address a rule stores has to be in the SAME form the capture path looks a rule up by, or the
  // rule is a row that can never match anything. Removing normalizeAddress from the create handler
  // leaves this rule stored as "Counsel@Opposing.TEST" and the reply lands unrouted.
  it("normalizes a correspondent address so the rule can match the mail it was made for", async () => {
    const matterId = await seedMatter();
    const created = await createRuleRequest(matterId, {
      kind: "correspondentMatter",
      correspondentAddress: "Counsel@Opposing.TEST",
    });
    expect(created.status).toBe(201);
    const rule = (await created.json()) as RuleBody;
    expect(rule.matchValue).toBe("counsel@opposing.test");

    // The add-in path carries the original bytes, which is the only path a sender-identity rule may
    // fire on at all — a forward has already broken the signature.
    const headerId = "rules-correspondent-match@example.test";
    await capture(
      messageBytes({
        messageId: headerId,
        from: "Opposing Counsel <counsel@opposing.test>",
        subject: "A new matter entirely",
      }),
      { capturedVia: "addin" },
    );
    const messageId = await messageIdFor(headerId);
    // The rule matched — the decision ledger records the evaluation even where the signature
    // guardrail then refused it, which is what makes "detection is always on" true.
    const { results } = await firmDatabase
      .prepare("SELECT auto_file_rule_id FROM email_auto_file_decision WHERE email_message_id = ?1")
      .bind(messageId)
      .all<{ auto_file_rule_id: string | null }>();
    expect(results.map((row) => row.auto_file_rule_id)).toEqual([rule.emailAutoFileRuleId]);
  });

  it("takes the sender from the filing when no address is given", async () => {
    const matterId = await seedMatter();
    const { originalMessageId } = await fileConversationByHand(matterId);
    const created = await createRuleRequest(matterId, {
      kind: "correspondentMatter",
      createdFromEmailMessageId: originalMessageId,
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      matchValue: "counsel@opposing.test",
      createdFromEmailMessageId: originalMessageId,
    });
  });

  // A thread rule's claim is "your firm already decided this conversation belongs here". Without a
  // filed link on this matter that claim is false, and the rule would be a guess dressed as the
  // strongest signal in the subsystem. Removing the readFiledMattersForThreads check turns this 422
  // into a 201 and lets a member bind any conversation to any matter they can open.
  it("refuses a thread rule for a conversation nobody has filed to that matter", async () => {
    const filedMatter = await seedMatter();
    const otherMatter = await seedMatter();
    const { originalMessageId } = await fileConversationByHand(filedMatter);

    const refused = await createRuleRequest(otherMatter, {
      kind: "threadContinuation",
      createdFromEmailMessageId: originalMessageId,
    });
    expect(refused.status).toBe(422);
    expect((await readJson<{ type: string }>(refused)).type).toBe(
      problemType("auto-file-rule-not-creatable"),
    );
    expect(await ruleRowCount(otherMatter)).toBe(0);
  });

  it("refuses a thread rule that names no filing to learn from", async () => {
    const matterId = await seedMatter();
    const refused = await createRuleRequest(matterId, { kind: "threadContinuation" });
    expect(refused.status).toBe(422);
    expect(await ruleRowCount(matterId)).toBe(0);
  });

  it("refuses a correspondent rule with no sender to match", async () => {
    const matterId = await seedMatter();
    const refused = await createRuleRequest(matterId, { kind: "correspondentMatter" });
    expect(refused.status).toBe(422);
    expect(await ruleRowCount(matterId)).toBe(0);
  });

  it("refuses a rule on a matter that is not open", async () => {
    const matterId = await seedMatter("closed");
    const refused = await createRuleRequest(matterId, {
      kind: "correspondentMatter",
      correspondentAddress: "counsel@opposing.test",
    });
    expect(refused.status).toBe(422);
    expect(await ruleRowCount(matterId)).toBe(0);
  });

  it("refuses the same rule twice and says which one already exists", async () => {
    const matterId = await seedMatter();
    const first = await createRuleRequest(matterId, {
      kind: "correspondentMatter",
      correspondentAddress: "counsel@opposing.test",
    });
    expect(first.status).toBe(201);
    // A different Idempotency-Key, so this is a genuine second attempt rather than a replay.
    const second = await createRuleRequest(matterId, {
      kind: "correspondentMatter",
      correspondentAddress: "counsel@opposing.test",
    });
    expect(second.status).toBe(409);
    expect((await readJson<{ type: string }>(second)).type).toBe(
      problemType("auto-file-rule-duplicate"),
    );
    expect(await ruleRowCount(matterId)).toBe(1);
  });

  it("returns the first rule on a replayed Idempotency-Key rather than minting a second", async () => {
    const matterId = await seedMatter();
    const headers = writeHeaders(ownerCookie);
    const body = JSON.stringify({
      kind: "correspondentMatter",
      correspondentAddress: "counsel@opposing.test",
    });
    const first = await SELF.fetch(`https://x/api/v1/matters/${matterId}/auto-file-rules`, {
      method: "POST",
      headers,
      body,
    });
    const replay = await SELF.fetch(`https://x/api/v1/matters/${matterId}/auto-file-rules`, {
      method: "POST",
      headers,
      body,
    });
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(await first.json());
    expect(await ruleRowCount(matterId)).toBe(1);
  });

  // Nothing retro-files. The rule applies to what arrives afterwards; a member who wants the archive
  // filed selects and files it, which is a different act with a different consent shape.
  it("leaves mail the firm already holds exactly where it was", async () => {
    const matterId = await seedMatter();
    const headerId = "rules-preexisting@example.test";
    await capture(
      messageBytes({
        messageId: headerId,
        from: "Opposing Counsel <counsel@opposing.test>",
        subject: "Arrived before any rule existed",
      }),
    );
    const messageId = await messageIdFor(headerId);
    const before = await linksFor(messageId);
    expect(before).toEqual([]);

    const created = await createRuleRequest(matterId, {
      kind: "correspondentMatter",
      correspondentAddress: "counsel@opposing.test",
    });
    expect(created.status).toBe(201);
    expect(await linksFor(messageId)).toEqual(before);
  });
});

describe("the firm ceiling is refused at, not worked around", () => {
  // Accepting `file` and quietly storing it would tell the member who set it that their firm had
  // opted into unattended filing. Removing the readAutoFileDirectFilingPermitted guard in the create
  // handler turns this 422 into a 201 and stores exactly that lie.
  it("refuses a rule asking to file while the firm has not permitted it, and stores nothing", async () => {
    const matterId = await seedMatter();
    const refused = await createRuleRequest(matterId, {
      kind: "correspondentMatter",
      correspondentAddress: "counsel@opposing.test",
      promotion: "file",
    });
    expect(refused.status).toBe(422);
    expect((await readJson<{ type: string }>(refused)).type).toBe(
      problemType("auto-file-direct-filing-not-permitted"),
    );
    expect(await ruleRowCount(matterId)).toBe(0);
  });

  it("refuses the same posture on an existing rule, and leaves the rule as it was", async () => {
    const matterId = await seedMatter();
    const created = await createRuleRequest(matterId, {
      kind: "correspondentMatter",
      correspondentAddress: "counsel@opposing.test",
    });
    const rule = (await created.json()) as RuleBody;

    const refused = await SELF.fetch(
      `https://x/api/v1/matters/${matterId}/auto-file-rules/${rule.emailAutoFileRuleId}`,
      {
        method: "PATCH",
        headers: writeHeaders(ownerCookie),
        body: JSON.stringify({ promotion: "file" }),
      },
    );
    expect(refused.status).toBe(422);
    const { results } = await firmDatabase
      .prepare("SELECT promotion FROM email_auto_file_rule WHERE id = ?1")
      .bind(rule.emailAutoFileRuleId)
      .all<{ promotion: string }>();
    expect(results[0]?.promotion).toBe("stage");
  });

  it("accepts the posture once an administrator has raised the ceiling", async () => {
    await setDirectFilingPermitted(true);
    const matterId = await seedMatter();
    const created = await createRuleRequest(matterId, {
      kind: "correspondentMatter",
      correspondentAddress: "counsel@opposing.test",
      promotion: "file",
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      promotion: "file",
      effectivePromotion: "file",
    });
  });

  // A rule that ASKS to file under a firm that has since lowered the ceiling still only stages, and a
  // reader shown only `promotion` would believe otherwise.
  it("reports what a rule would actually do, not only what it asks for", async () => {
    await setDirectFilingPermitted(true);
    const matterId = await seedMatter();
    await createRuleRequest(matterId, {
      kind: "correspondentMatter",
      correspondentAddress: "counsel@opposing.test",
      promotion: "file",
    });
    await setDirectFilingPermitted(false);

    const listed = await SELF.fetch(`https://x/api/v1/matters/${matterId}/auto-file-rules`, {
      headers: { cookie: ownerCookie },
    });
    const body = (await listed.json()) as { data: RuleBody[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ promotion: "file", effectivePromotion: "stage" });
  });
});

describe("who may configure the machine to file mail", () => {
  // "May file mail" and "may set up automatic filing" are separate grants. A Paralegal holds
  // emails:read and emails:manageLinks and not emails:manageAutoFileRules, so the two answers here
  // must differ — if they ever agree, the separate capability has stopped meaning anything.
  it("refuses a member who may file mail but may not configure a rule", async () => {
    const matterId = await seedMatter();
    const refused = await createRuleRequest(
      matterId,
      { kind: "correspondentMatter", correspondentAddress: "counsel@opposing.test" },
      paralegalCookie,
    );
    expect(refused.status).toBe(403);
    expect(await ruleRowCount(matterId)).toBe(0);
  });

  it("lets that same member read the matter's rules", async () => {
    const matterId = await seedMatter();
    await createRuleRequest(matterId, {
      kind: "correspondentMatter",
      correspondentAddress: "counsel@opposing.test",
    });
    const listed = await SELF.fetch(`https://x/api/v1/matters/${matterId}/auto-file-rules`, {
      headers: { cookie: paralegalCookie },
    });
    expect(listed.status).toBe(200);
    expect((await readJson<{ data: RuleBody[] }>(listed)).data).toHaveLength(1);
  });

  it("refuses every transition for that member too", async () => {
    const matterId = await seedMatter();
    const created = await createRuleRequest(matterId, {
      kind: "correspondentMatter",
      correspondentAddress: "counsel@opposing.test",
    });
    const rule = (await created.json()) as RuleBody;
    const base = `https://x/api/v1/matters/${matterId}/auto-file-rules/${rule.emailAutoFileRuleId}`;
    for (const [method, path] of [
      ["POST", `${base}/suspend`],
      ["POST", `${base}/resume`],
      ["DELETE", base],
    ] as const) {
      const response = await SELF.fetch(path, {
        method,
        headers: writeHeaders(paralegalCookie),
      });
      expect(response.status).toBe(403);
    }
    const { results } = await firmDatabase
      .prepare("SELECT state FROM email_auto_file_rule WHERE id = ?1")
      .bind(rule.emailAutoFileRuleId)
      .all<{ state: string }>();
    expect(results[0]?.state).toBe("active");
  });
});

describe("stopping a rule", () => {
  async function ruleOnFiledConversation(): Promise<{
    matterId: MatterId;
    ruleId: string;
    originalHeaderId: string;
  }> {
    const matterId = await seedMatter();
    const { originalHeaderId, originalMessageId } = await fileConversationByHand(matterId);
    const created = await createRuleRequest(matterId, {
      kind: "threadContinuation",
      createdFromEmailMessageId: originalMessageId,
    });
    const rule = (await created.json()) as RuleBody;
    return { matterId, ruleId: rule.emailAutoFileRuleId, originalHeaderId };
  }

  // A suspension that answers 200 over a rule that keeps filing is the exact shape that leaves a firm
  // believing it stopped something it did not. So the consequence is asserted, not the response.
  it("stops the rule acting on the next message", async () => {
    const { matterId, ruleId, originalHeaderId } = await ruleOnFiledConversation();
    const suspended = await SELF.fetch(
      `https://x/api/v1/matters/${matterId}/auto-file-rules/${ruleId}/suspend`,
      { method: "POST", headers: writeHeaders(ownerCookie) },
    );
    expect(suspended.status).toBe(200);
    expect(await suspended.json()).toMatchObject({
      state: "suspended",
      suspendedReason: "member",
    });

    const replyHeaderId = "rules-reply-after-suspend@example.test";
    await capture(
      messageBytes({
        messageId: replyHeaderId,
        from: "Opposing Counsel <counsel@opposing.test>",
        subject: "Re: Retainer",
        inReplyTo: originalHeaderId,
      }),
    );
    expect(await linksFor(await messageIdFor(replyHeaderId))).toEqual([]);
  });

  it("puts it back in service on resume, and only then", async () => {
    const { matterId, ruleId, originalHeaderId } = await ruleOnFiledConversation();
    // Resuming a rule nobody suspended is refused rather than answered as a no-op.
    const early = await SELF.fetch(
      `https://x/api/v1/matters/${matterId}/auto-file-rules/${ruleId}/resume`,
      { method: "POST", headers: writeHeaders(ownerCookie) },
    );
    expect(early.status).toBe(409);

    await SELF.fetch(`https://x/api/v1/matters/${matterId}/auto-file-rules/${ruleId}/suspend`, {
      method: "POST",
      headers: writeHeaders(ownerCookie),
    });
    const resumed = await SELF.fetch(
      `https://x/api/v1/matters/${matterId}/auto-file-rules/${ruleId}/resume`,
      { method: "POST", headers: writeHeaders(ownerCookie) },
    );
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toMatchObject({
      state: "active",
      suspendedReason: null,
    });

    const replyHeaderId = "rules-reply-after-resume@example.test";
    await capture(
      messageBytes({
        messageId: replyHeaderId,
        from: "Opposing Counsel <counsel@opposing.test>",
        subject: "Re: Retainer",
        inReplyTo: originalHeaderId,
      }),
    );
    expect(await linksFor(await messageIdFor(replyHeaderId))).toEqual([
      { matter_id: matterId, state: "staged", auto_file_rule_id: ruleId },
    ]);
  });

  // Resuming is not a sweep either: the mail that arrived while the rule was stopped stays where it
  // was, because a rule only ever applies forward.
  it("does not reach back over the mail that arrived while it was stopped", async () => {
    const { matterId, ruleId, originalHeaderId } = await ruleOnFiledConversation();
    await SELF.fetch(`https://x/api/v1/matters/${matterId}/auto-file-rules/${ruleId}/suspend`, {
      method: "POST",
      headers: writeHeaders(ownerCookie),
    });
    const missedHeaderId = "rules-reply-while-stopped@example.test";
    await capture(
      messageBytes({
        messageId: missedHeaderId,
        from: "Opposing Counsel <counsel@opposing.test>",
        subject: "Re: Retainer",
        inReplyTo: originalHeaderId,
      }),
    );
    const missedId = await messageIdFor(missedHeaderId);
    expect(await linksFor(missedId)).toEqual([]);

    await SELF.fetch(`https://x/api/v1/matters/${matterId}/auto-file-rules/${ruleId}/resume`, {
      method: "POST",
      headers: writeHeaders(ownerCookie),
    });
    expect(await linksFor(missedId)).toEqual([]);
  });

  it("revokes for good, and refuses to resurrect", async () => {
    const { matterId, ruleId } = await ruleOnFiledConversation();
    const revoked = await SELF.fetch(
      `https://x/api/v1/matters/${matterId}/auto-file-rules/${ruleId}`,
      { method: "DELETE", headers: writeHeaders(ownerCookie) },
    );
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toMatchObject({ state: "revoked" });

    for (const path of [
      `https://x/api/v1/matters/${matterId}/auto-file-rules/${ruleId}/resume`,
      `https://x/api/v1/matters/${matterId}/auto-file-rules/${ruleId}/suspend`,
    ]) {
      const response = await SELF.fetch(path, {
        method: "POST",
        headers: writeHeaders(ownerCookie),
      });
      expect(response.status).toBe(409);
    }
    const again = await SELF.fetch(
      `https://x/api/v1/matters/${matterId}/auto-file-rules/${ruleId}`,
      { method: "DELETE", headers: writeHeaders(ownerCookie) },
    );
    expect(again.status).toBe(409);

    // Revocation is not deletion: the row survives so the links it made stay explicable.
    const { results } = await firmDatabase
      .prepare("SELECT state FROM email_auto_file_rule WHERE id = ?1")
      .bind(ruleId)
      .all<{ state: string }>();
    expect(results[0]?.state).toBe("revoked");
  });

  // Addressing a rule through a matter the caller happens to hold, rather than the rule's own, would
  // let access to one matter act on another's delegation. Dropping the `rule.matterId !== matterId`
  // guard turns this 404 into a 200 that suspends somebody else's rule.
  it("refuses a rule reached through the wrong matter's path", async () => {
    const { ruleId } = await ruleOnFiledConversation();
    const otherMatter = await seedMatter();
    const response = await SELF.fetch(
      `https://x/api/v1/matters/${otherMatter}/auto-file-rules/${ruleId}/suspend`,
      { method: "POST", headers: writeHeaders(ownerCookie) },
    );
    expect(response.status).toBe(404);
    const { results } = await firmDatabase
      .prepare("SELECT state FROM email_auto_file_rule WHERE id = ?1")
      .bind(ruleId)
      .all<{ state: string }>();
    expect(results[0]?.state).toBe("active");
  });
});

describe("what the rules have been doing", () => {
  it("explains why a message filed itself, in sentences carrying no message content", async () => {
    const matterId = await seedMatter();
    const { originalHeaderId, originalMessageId } = await fileConversationByHand(matterId);
    await createRuleRequest(matterId, {
      kind: "threadContinuation",
      createdFromEmailMessageId: originalMessageId,
    });
    const replyHeaderId = "rules-why-am-i-here@example.test";
    await capture(
      messageBytes({
        messageId: replyHeaderId,
        from: "Opposing Counsel <counsel@opposing.test>",
        subject: "Re: Retainer secret subject",
        inReplyTo: originalHeaderId,
      }),
    );
    const replyId = await messageIdFor(replyHeaderId);

    const read = await SELF.fetch(`https://x/api/v1/emails/${replyId}/auto-file-decisions`, {
      headers: { cookie: ownerCookie },
    });
    expect(read.status).toBe(200);
    const body = (await read.json()) as {
      data: { outcome: string; demotionReason: string | null; reasons: string[] }[];
    };
    expect(body.data).toHaveLength(1);
    const [decision] = body.data;
    expect(decision?.outcome).toBe("staged");
    // The rule wanted to stage, so that is the reason reported — not the first check consulted.
    expect(decision?.demotionReason).toBe("rulePosture");
    expect(decision?.reasons).toEqual([
      "This conversation is already filed to this matter.",
      "This rule places the message on the matter and leaves the filing to a person.",
    ]);
    // The ledger holds identifiers and enums; nothing rendered from it may carry the message.
    const rendered = JSON.stringify(body);
    for (const leak of ["secret subject", "counsel@opposing.test", "Opposing Counsel"]) {
      expect(rendered).not.toContain(leak);
    }
  });

  it("has nothing to say about a message no rule ever looked at", async () => {
    const headerId = "rules-untouched@example.test";
    await capture(
      messageBytes({
        messageId: headerId,
        from: "Stranger <stranger@nowhere.test>",
        subject: "Nothing to do with anything",
      }),
    );
    const read = await SELF.fetch(
      `https://x/api/v1/emails/${await messageIdFor(headerId)}/auto-file-decisions`,
      { headers: { cookie: ownerCookie } },
    );
    expect(read.status).toBe(200);
    // `capped` false, not absent: "no rule looked at this" and "we stopped counting" are different
    // answers, and the empty case has to carry the flag for the difference to mean anything.
    expect(await read.json()).toEqual({ data: [], capped: false });
  });

  it("counts what each rule placed, and what somebody has since taken off", async () => {
    const matterId = await seedMatter();
    const { originalHeaderId, originalMessageId } = await fileConversationByHand(matterId);
    const created = await createRuleRequest(matterId, {
      kind: "threadContinuation",
      createdFromEmailMessageId: originalMessageId,
    });
    const rule = (await created.json()) as RuleBody;

    for (const suffix of ["a", "b", "c"]) {
      await capture(
        messageBytes({
          messageId: `rules-review-${suffix}@example.test`,
          from: "Opposing Counsel <counsel@opposing.test>",
          subject: "Re: Retainer",
          inReplyTo: originalHeaderId,
        }),
      );
    }
    // One of them removed by hand — the ordinary unlink, which is also the feedback signal.
    const undoneId = await messageIdFor("rules-review-b@example.test");
    const unlinked = await SELF.fetch(`https://x/api/v1/matters/${matterId}/emails/${undoneId}`, {
      method: "DELETE",
      headers: { cookie: ownerCookie },
    });
    expect(unlinked.status).toBe(200);

    const review = await SELF.fetch("https://x/api/v1/emails/auto-file-review", {
      headers: { cookie: ownerCookie },
    });
    expect(review.status).toBe(200);
    const body = (await review.json()) as {
      windowStart: string;
      data: {
        emailAutoFileRuleId: string;
        state: string;
        filedCount: number;
        stagedCount: number;
        undoneCount: number;
      }[];
    };
    expect(body.data).toEqual([
      expect.objectContaining({
        emailAutoFileRuleId: rule.emailAutoFileRuleId,
        state: "active",
        filedCount: 0,
        stagedCount: 2,
        undoneCount: 1,
      }),
    ]);
  });

  it("keeps a suspended rule in the review with the reason it stopped", async () => {
    const matterId = await seedMatter();
    const { originalHeaderId, originalMessageId } = await fileConversationByHand(matterId);
    const created = await createRuleRequest(matterId, {
      kind: "threadContinuation",
      createdFromEmailMessageId: originalMessageId,
    });
    const rule = (await created.json()) as RuleBody;
    await capture(
      messageBytes({
        messageId: "rules-review-suspended@example.test",
        from: "Opposing Counsel <counsel@opposing.test>",
        subject: "Re: Retainer",
        inReplyTo: originalHeaderId,
      }),
    );
    await SELF.fetch(
      `https://x/api/v1/matters/${matterId}/auto-file-rules/${rule.emailAutoFileRuleId}/suspend`,
      { method: "POST", headers: writeHeaders(ownerCookie) },
    );

    const review = await SELF.fetch("https://x/api/v1/emails/auto-file-review", {
      headers: { cookie: ownerCookie },
    });
    expect(await review.json()).toMatchObject({
      data: [expect.objectContaining({ state: "suspended", suspendedReason: "member" })],
    });
  });

  it("reports nothing for a firm whose rules have done nothing", async () => {
    const review = await SELF.fetch("https://x/api/v1/emails/auto-file-review", {
      headers: { cookie: ownerCookie },
    });
    expect(review.status).toBe(200);
    expect(await review.json()).toMatchObject({ data: [] });
  });

  it("refuses the review to a member without emails:read", async () => {
    const stranger = await seedCredentialedUser("rule-surface-stranger@example.com", {
      userName: "Rule Surface Stranger",
      firmId,
    });
    await insertMemberStatement(firmDatabase, {
      userId: stranger.userId,
      displayName: "Rule Surface Stranger",
      now: clock.now(),
    }).run();
    const strangerCookie = await signInForSessionCookie("rule-surface-stranger@example.com");
    const review = await SELF.fetch("https://x/api/v1/emails/auto-file-review", {
      headers: { cookie: strangerCookie },
    });
    expect(review.status).toBe(403);
  });
});
