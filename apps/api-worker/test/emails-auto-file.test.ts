import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  EmailAutoFileRuleId,
  EmailMessageId,
  FirmId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { handleCaptureMessage } from "../src/background/emails/capture-consumer.ts";
import type { EmailsCaptureMessage } from "../src/emails/capture-types.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The whole point of this slice, exercised where it actually runs: a message arrives on the firm
// catch-all with no matter, the rules are evaluated on the queue consumer, and the result — a staged
// link by default, a filed one only where the firm and the rule both asked — rides the capture's own
// atomic batch alongside the ledger row that explains it.

let firmId: FirmId;
let ownerUserId: UserId;
let ownerCookie: string;
let noPermissionCookie: string;
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
      "Body text that must never reach a ledger row or an audit row.",
    ].join("\r\n"),
  );
}

async function seedMatter(status: "open" | "closed" = "open"): Promise<MatterId> {
  const matterId = newIdentifier("matter");
  await firmDatabase
    .prepare(
      `INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at)
       VALUES (?1, 'Auto File Matter', ?2, ?3, 0, ?4, ?4)`,
    )
    .bind(matterId, status, ownerUserId, clock.now())
    .run();
  return matterId;
}

// Stage the bytes to R2 and run the consumer, exactly as the Email Worker's forward entrance would.
// `matterId: null` and `captureToken: null` is the firm catch-all: captured to the firm, routed
// nowhere, which is the path auto-file rules exist for.
async function capture(
  bytes: Uint8Array,
  overrides: Partial<EmailsCaptureMessage> = {},
): Promise<string> {
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
  return jobId;
}

async function createRule(input: {
  kind: "threadContinuation" | "correspondentMatter";
  matterId: MatterId;
  matchValue: string;
  promotion?: "stage" | "file";
  createdBy?: UserId | null;
}): Promise<EmailAutoFileRuleId> {
  const ruleId = newIdentifier("emailAutoFileRule");
  await firmDatabase
    .prepare(
      `INSERT INTO email_auto_file_rule
         (id, kind, matter_id, match_value, promotion, state, created_by, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7, ?7)`,
    )
    .bind(
      ruleId,
      input.kind,
      input.matterId,
      input.matchValue,
      input.promotion ?? "stage",
      input.createdBy === undefined ? ownerUserId : input.createdBy,
      clock.now(),
    )
    .run();
  return ruleId as EmailAutoFileRuleId;
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

interface DecisionRow {
  auto_file_rule_id: string | null;
  matter_id: string | null;
  outcome: string;
  suppression_reason: string | null;
  evidence: string;
}

async function decisionsFor(emailMessageId: string): Promise<DecisionRow[]> {
  const { results } = await firmDatabase
    .prepare(
      "SELECT auto_file_rule_id, matter_id, outcome, suppression_reason, evidence FROM email_auto_file_decision WHERE email_message_id = ?1 ORDER BY created_at ASC, id ASC",
    )
    .bind(emailMessageId)
    .all<DecisionRow>();
  return results;
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

async function threadIdFor(emailMessageId: string): Promise<string> {
  const { results } = await firmDatabase
    .prepare("SELECT thread_id FROM email_message WHERE id = ?1")
    .bind(emailMessageId)
    .all<{ thread_id: string }>();
  const found = results[0]?.thread_id;
  if (found === undefined) throw new Error(`no thread for ${emailMessageId}`);
  return found;
}

// Land a filed original on `matterId` and return the thread a reply to it will join. This is the
// thread-continuation condition in its honest form: the firm already decided this conversation
// belongs to that matter.
let conversationCounter = 0;
async function seedFiledConversation(
  matterId: MatterId,
): Promise<{ threadId: string; originalHeaderId: string; originalMessageId: EmailMessageId }> {
  conversationCounter += 1;
  const originalHeaderId = `original-${conversationCounter}@example.test`;
  await capture(
    messageBytes({
      messageId: originalHeaderId,
      from: "Opposing Counsel <counsel@opposing.test>",
      subject: `Retainer ${conversationCounter}`,
    }),
    { matterId, capturedVia: "api", acceptOnCapture: true, linkedBy: ownerUserId },
  );
  const originalMessageId = await messageIdFor(originalHeaderId);
  return {
    threadId: await threadIdFor(originalMessageId),
    originalHeaderId,
    originalMessageId,
  };
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
  firmId = (await seedFirm({ name: "Auto File Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
  const owner = await seedCredentialedUser("auto-file-owner@example.com", {
    userName: "Auto File Owner",
    firmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Auto File Owner", firmId);
  ownerCookie = await signInForSessionCookie("auto-file-owner@example.com");

  const noPermission = await seedCredentialedUser("auto-file-noperm@example.com", {
    userName: "No Permission",
    firmId,
  });
  await insertMemberStatement(firmDatabase, {
    userId: noPermission.userId,
    displayName: "No Permission",
    now: clock.now(),
  }).run();
  noPermissionCookie = await signInForSessionCookie("auto-file-noperm@example.com");
});

// Each test states its own rule population and its own firm posture. Rules and ledger rows are swept
// between tests (the link's rule reference first, since it is a foreign key) so a rule written for one
// case cannot quietly become a second matcher — and a second matcher is ambiguity, which would make
// every later test pass for the wrong reason.
beforeEach(async () => {
  await firmDatabase.prepare("UPDATE email_matter_link SET auto_file_rule_id = NULL").run();
  await firmDatabase.prepare("DELETE FROM email_auto_file_decision").run();
  await firmDatabase.prepare("DELETE FROM email_auto_file_rule").run();
  await setDirectFilingPermitted(false);
});

describe("auto-file rules in the capture consumer", () => {
  it("stages an unrouted reply onto the matter its conversation is already filed to", async () => {
    const matterId = await seedMatter();
    const { threadId, originalHeaderId } = await seedFiledConversation(matterId);
    const ruleId = await createRule({ kind: "threadContinuation", matterId, matchValue: threadId });

    const replyHeaderId = `reply-stage@example.test`;
    await capture(
      messageBytes({
        messageId: replyHeaderId,
        from: "Opposing Counsel <counsel@opposing.test>",
        subject: "Re: Retainer 1",
        inReplyTo: originalHeaderId,
      }),
    );
    const replyId = await messageIdFor(replyHeaderId);
    expect(await linksFor(replyId)).toEqual([
      { matter_id: matterId, state: "staged", auto_file_rule_id: ruleId },
    ]);

    const decisions = await decisionsFor(replyId);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.outcome).toBe("staged");
    expect(decisions[0]?.suppression_reason).toBeNull();
    expect(decisions[0]?.auto_file_rule_id).toBe(ruleId);
    // Staged because the RULE only ever asked to stage — the honest answer, not "the firm policy
    // stopped it", which is what a reader would otherwise conclude.
    expect(JSON.parse(decisions[0]?.evidence ?? "{}")).toMatchObject({
      decision: "stage",
      demotionReason: "rulePosture",
    });
  });

  it("files directly only when the firm raised the ceiling AND the rule asked for it", async () => {
    const matterId = await seedMatter();
    const { threadId, originalHeaderId } = await seedFiledConversation(matterId);
    const ruleId = await createRule({
      kind: "threadContinuation",
      matterId,
      matchValue: threadId,
      promotion: "file",
    });

    // Ceiling down: the rule's own posture is not enough.
    const heldHeaderId = "reply-policy-off@example.test";
    await capture(
      messageBytes({
        messageId: heldHeaderId,
        from: "Opposing Counsel <counsel@opposing.test>",
        subject: "Re: Retainer 2",
        inReplyTo: originalHeaderId,
      }),
    );
    const heldId = await messageIdFor(heldHeaderId);
    expect((await linksFor(heldId))[0]?.state).toBe("staged");
    expect(JSON.parse((await decisionsFor(heldId))[0]?.evidence ?? "{}")).toMatchObject({
      demotionReason: "firmPolicyDirectFilingOff",
    });

    // Ceiling up: the next capture files, with no re-ingest of anything already captured.
    await setDirectFilingPermitted(true);
    const filedHeaderId = "reply-policy-on@example.test";
    await capture(
      messageBytes({
        messageId: filedHeaderId,
        from: "Opposing Counsel <counsel@opposing.test>",
        subject: "Re: Retainer 2 again",
        inReplyTo: originalHeaderId,
      }),
    );
    const filedId = await messageIdFor(filedHeaderId);
    expect(await linksFor(filedId)).toEqual([
      { matter_id: matterId, state: "filed", auto_file_rule_id: ruleId },
    ]);
    expect((await decisionsFor(filedId))[0]?.outcome).toBe("filed");

    // And the audit row a firm reads when it asks what the machine did.
    const { results } = await firmDatabase
      .prepare("SELECT event, actor_user_id, metadata FROM audit_log WHERE subject_id = ?1")
      .bind(filedId)
      .all<{ event: string; actor_user_id: string | null; metadata: string }>();
    expect(results.map((row) => row.event)).toContain("emails.autoFiled");
    const autoFiled = results.find((row) => row.event === "emails.autoFiled");
    expect(autoFiled?.actor_user_id).toBeNull();
    expect(JSON.parse(autoFiled?.metadata ?? "{}")).toEqual({ matterId, ruleId });

    // The held capture earlier in this test staged, so it carries the staged event, not the filed one.
    const { results: heldAudit } = await firmDatabase
      .prepare("SELECT event FROM audit_log WHERE subject_id = ?1")
      .bind(heldId)
      .all<{ event: string }>();
    expect(heldAudit.map((row) => row.event)).toContain("emails.autoFileStaged");
  });

  it("never fires when the precise evidence names more than one matter", async () => {
    const matterOne = await seedMatter();
    const matterTwo = await seedMatter();
    const { threadId, originalHeaderId } = await seedFiledConversation(matterOne);
    await createRule({ kind: "threadContinuation", matterId: matterOne, matchValue: threadId });
    await createRule({
      kind: "correspondentMatter",
      matterId: matterTwo,
      matchValue: "counsel@opposing.test",
    });

    const headerId = "reply-ambiguous@example.test";
    await capture(
      messageBytes({
        messageId: headerId,
        from: "Opposing Counsel <counsel@opposing.test>",
        subject: "Re: Retainer 3",
        inReplyTo: originalHeaderId,
      }),
    );
    const messageId = await messageIdFor(headerId);
    expect(await linksFor(messageId)).toEqual([]);
    const decisions = await decisionsFor(messageId);
    expect(decisions[0]?.outcome).toBe("suppressed");
    expect(decisions[0]?.suppression_reason).toBe("ambiguousEvidence");
  });

  it("never files on a forwarded sender-identity rule — the signature cannot answer for the sender", async () => {
    const matterId = await seedMatter();
    const ruleId = await createRule({
      kind: "correspondentMatter",
      matterId,
      matchValue: "counsel@opposing.test",
    });

    const headerId = "forward-correspondent@example.test";
    await capture(
      messageBytes({
        messageId: headerId,
        from: "Opposing Counsel <counsel@opposing.test>",
        subject: "Forwarded correspondence",
      }),
    );
    const messageId = await messageIdFor(headerId);
    expect(await linksFor(messageId)).toEqual([]);
    const decisions = await decisionsFor(messageId);
    expect(decisions[0]?.outcome).toBe("suppressed");
    expect(decisions[0]?.suppression_reason).toBe("senderNotAuthenticated");
    expect(decisions[0]?.auto_file_rule_id).toBe(ruleId);
  });

  it("never puts back a message a person removed from the matter", async () => {
    const matterId = await seedMatter();
    const { threadId, originalHeaderId } = await seedFiledConversation(matterId);
    await createRule({ kind: "threadContinuation", matterId, matchValue: threadId });

    const headerId = "reply-unlinked@example.test";
    const bytes = messageBytes({
      messageId: headerId,
      from: "Opposing Counsel <counsel@opposing.test>",
      subject: "Re: Retainer 5",
      inReplyTo: originalHeaderId,
    });
    await capture(bytes);
    const messageId = await messageIdFor(headerId);
    expect((await linksFor(messageId))[0]?.state).toBe("staged");

    // A person removes it. The ordinary unlink — no rule-specific reversal path exists, by design.
    await firmDatabase
      .prepare(
        "UPDATE email_matter_link SET state = 'unlinked', updated_at = ?1 WHERE email_message_id = ?2",
      )
      .bind(clock.now(), messageId)
      .run();

    // The same message arrives again. The rule still matches; it must decline.
    await capture(bytes);
    expect((await linksFor(messageId))[0]?.state).toBe("unlinked");
    const decisions = await decisionsFor(messageId);
    expect(decisions.at(-1)?.outcome).toBe("suppressed");
    expect(decisions.at(-1)?.suppression_reason).toBe("humanFilingDecision");
  });

  it("never fires into a closed matter, and suspends the stale rule that named it", async () => {
    const matterId = await seedMatter();
    const { threadId, originalHeaderId } = await seedFiledConversation(matterId);
    const ruleId = await createRule({ kind: "threadContinuation", matterId, matchValue: threadId });
    await firmDatabase
      .prepare("UPDATE matter SET status = 'closed' WHERE id = ?1")
      .bind(matterId)
      .run();

    const headerId = "reply-closed@example.test";
    await capture(
      messageBytes({
        messageId: headerId,
        from: "Opposing Counsel <counsel@opposing.test>",
        subject: "Re: Retainer 6",
        inReplyTo: originalHeaderId,
      }),
    );
    const messageId = await messageIdFor(headerId);
    expect(await linksFor(messageId)).toEqual([]);
    expect((await decisionsFor(messageId))[0]?.suppression_reason).toBe("matterNotOpen");

    const { results } = await firmDatabase
      .prepare("SELECT state, suspended_reason FROM email_auto_file_rule WHERE id = ?1")
      .bind(ruleId)
      .all<{ state: string; suspended_reason: string | null }>();
    expect(results[0]).toEqual({ state: "suspended", suspended_reason: "matterClosed" });
  });

  it("trips the circuit breaker on a burst, stages instead, and stops the rule", async () => {
    const matterId = await seedMatter();
    const { threadId, originalHeaderId } = await seedFiledConversation(matterId);
    const ruleId = await createRule({
      kind: "threadContinuation",
      matterId,
      matchValue: threadId,
      promotion: "file",
    });
    await setDirectFilingPermitted(true);

    // Twenty-five firings already inside the rolling window, as the ledger would hold them.
    const now = clock.now();
    for (let index = 0; index < 25; index += 1) {
      await firmDatabase
        .prepare(
          `INSERT INTO email_auto_file_decision
             (id, email_message_id, auto_file_rule_id, matter_id, outcome, suppression_reason, evidence, created_at)
           VALUES (?1, ?2, ?3, ?4, 'filed', NULL, '{}', ?5)`,
        )
        .bind(
          newIdentifier("emailAutoFileDecision"),
          await messageIdFor(originalHeaderId),
          ruleId,
          matterId,
          now,
        )
        .run();
    }

    const headerId = "reply-burst@example.test";
    await capture(
      messageBytes({
        messageId: headerId,
        from: "Opposing Counsel <counsel@opposing.test>",
        subject: "Re: Retainer 7",
        inReplyTo: originalHeaderId,
      }),
    );
    const messageId = await messageIdFor(headerId);
    // The message still belongs on the matter — it is the unattended FILING that stopped.
    expect((await linksFor(messageId))[0]).toEqual({
      matter_id: matterId,
      state: "staged",
      auto_file_rule_id: ruleId,
    });
    expect(JSON.parse((await decisionsFor(messageId)).at(-1)?.evidence ?? "{}")).toMatchObject({
      demotionReason: "blastBound",
      suspensionReason: "blastBound",
    });
    const { results } = await firmDatabase
      .prepare("SELECT state, suspended_reason FROM email_auto_file_rule WHERE id = ?1")
      .bind(ruleId)
      .all<{ state: string; suspended_reason: string | null }>();
    expect(results[0]).toEqual({ state: "suspended", suspended_reason: "blastBound" });
  });

  it("writes nothing at all for a capture no rule looked at", async () => {
    const headerId = "no-rule@example.test";
    await capture(
      messageBytes({
        messageId: headerId,
        from: "Stranger <stranger@nowhere.test>",
        subject: "Cold outreach",
      }),
    );
    const messageId = await messageIdFor(headerId);
    expect(await linksFor(messageId)).toEqual([]);
    expect(await decisionsFor(messageId)).toEqual([]);
  });

  it("does not consult the rules when the entrance already routed the capture", async () => {
    const entranceMatter = await seedMatter();
    const ruleMatter = await seedMatter();
    await createRule({
      kind: "correspondentMatter",
      matterId: ruleMatter,
      matchValue: "counsel@opposing.test",
    });
    const headerId = "routed-by-entrance@example.test";
    await capture(
      messageBytes({
        messageId: headerId,
        from: "Opposing Counsel <counsel@opposing.test>",
        subject: "Routed already",
      }),
      { matterId: entranceMatter, capturedVia: "api", linkedBy: ownerUserId },
    );
    const messageId = await messageIdFor(headerId);
    expect(await linksFor(messageId)).toEqual([
      { matter_id: entranceMatter, state: "staged", auto_file_rule_id: null },
    ]);
    expect(await decisionsFor(messageId)).toEqual([]);
  });

  it("replays a redelivered job instead of deciding a second time", async () => {
    const matterId = await seedMatter();
    const { threadId, originalHeaderId } = await seedFiledConversation(matterId);
    await createRule({ kind: "threadContinuation", matterId, matchValue: threadId });

    const headerId = "reply-redelivered@example.test";
    const bytes = messageBytes({
      messageId: headerId,
      from: "Opposing Counsel <counsel@opposing.test>",
      subject: "Re: Retainer 10",
      inReplyTo: originalHeaderId,
    });
    const jobId = newIdentifier("idempotencyRecord");
    const stagedR2Key = `emails/staging/${jobId}`;
    const job: EmailsCaptureMessage = {
      firmId,
      bucketName: "test-bucket",
      stagedR2Key,
      capturedVia: "forward",
      matterId: null,
      captureToken: null,
      linkedBy: null,
      acceptOnCapture: false,
      jobId,
    };
    await env.R2.put(stagedR2Key, bytes);
    await handleCaptureMessage(env, job);
    await env.R2.put(stagedR2Key, bytes);
    await handleCaptureMessage(env, job);

    const messageId = await messageIdFor(headerId);
    expect(await linksFor(messageId)).toHaveLength(1);
    expect(await decisionsFor(messageId)).toHaveLength(1);
  });

  it("keeps message content out of every row a firing writes", async () => {
    const matterId = await seedMatter();
    const { threadId, originalHeaderId } = await seedFiledConversation(matterId);
    await createRule({ kind: "threadContinuation", matterId, matchValue: threadId });
    const subject = "Re: Privileged strategy note";
    const from = "Opposing Counsel <counsel@opposing.test>";
    const headerId = "reply-redaction@example.test";
    await capture(
      messageBytes({ messageId: headerId, from, subject, inReplyTo: originalHeaderId }),
    );
    const messageId = await messageIdFor(headerId);

    const ledger = JSON.stringify(await decisionsFor(messageId));
    const { results: auditRows } = await firmDatabase
      .prepare("SELECT event, metadata FROM audit_log WHERE subject_id = ?1")
      .bind(messageId)
      .all<{ event: string; metadata: string }>();
    const audit = JSON.stringify(auditRows);
    for (const forbidden of [
      subject,
      "Privileged",
      "counsel@opposing.test",
      "Opposing Counsel",
      "Body text",
    ]) {
      expect(ledger).not.toContain(forbidden);
      expect(audit).not.toContain(forbidden);
    }
  });
});

describe("the firm auto-file policy route", () => {
  // The numbers the circuit breaker shipped with, which a firm that never opens this surface keeps.
  const PLATFORM_DEFAULT_BREAKER = {
    maxFiresPerWindow: 25,
    recentFireWindow: 10,
    maxUndosInRecentFires: 3,
  };

  it("reads off by default, flips with a patch, and refuses a member without the capability", async () => {
    const read = await SELF.fetch("https://x/api/v1/firm/email-auto-file-policy", {
      headers: { cookie: ownerCookie },
    });
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({
      directFilingPermitted: false,
      circuitBreaker: PLATFORM_DEFAULT_BREAKER,
    });

    const patched = await SELF.fetch("https://x/api/v1/firm/email-auto-file-policy", {
      method: "PATCH",
      headers: {
        cookie: ownerCookie,
        "content-type": "application/json",
        "idempotency-key": newIdentifier("idempotencyRecord"),
      },
      body: JSON.stringify({ directFilingPermitted: true }),
    });
    expect(patched.status).toBe(200);
    // A patch that names one field leaves the other at what it was.
    expect(await patched.json()).toEqual({
      directFilingPermitted: true,
      circuitBreaker: PLATFORM_DEFAULT_BREAKER,
    });

    const refused = await SELF.fetch("https://x/api/v1/firm/email-auto-file-policy", {
      headers: { cookie: noPermissionCookie },
    });
    expect(refused.status).toBe(403);
  });

  it("sets the firm's circuit-breaker thresholds and reads them back", async () => {
    const circuitBreaker = {
      maxFiresPerWindow: 60,
      recentFireWindow: 20,
      maxUndosInRecentFires: 5,
    };
    const patched = await SELF.fetch("https://x/api/v1/firm/email-auto-file-policy", {
      method: "PATCH",
      headers: {
        cookie: ownerCookie,
        "content-type": "application/json",
        "idempotency-key": newIdentifier("idempotencyRecord"),
      },
      body: JSON.stringify({ circuitBreaker }),
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ circuitBreaker });

    const read = await SELF.fetch("https://x/api/v1/firm/email-auto-file-policy", {
      headers: { cookie: ownerCookie },
    });
    expect(await read.json()).toMatchObject({ circuitBreaker });
  });

  // A circuit breaker a firm can switch off is not a circuit breaker: every threshold is a whole
  // number inside a fixed range, and the undo threshold may not exceed the window it is counted over.
  it("refuses thresholds that would put the breaker out of reach", async () => {
    for (const circuitBreaker of [
      { maxFiresPerWindow: 100000, recentFireWindow: 10, maxUndosInRecentFires: 3 },
      { maxFiresPerWindow: 0, recentFireWindow: 10, maxUndosInRecentFires: 3 },
      { maxFiresPerWindow: 25, recentFireWindow: 10, maxUndosInRecentFires: 0 },
      { maxFiresPerWindow: 25, recentFireWindow: 10, maxUndosInRecentFires: 11 },
      { maxFiresPerWindow: 25.5, recentFireWindow: 10, maxUndosInRecentFires: 3 },
    ]) {
      const response = await SELF.fetch("https://x/api/v1/firm/email-auto-file-policy", {
        method: "PATCH",
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
          "idempotency-key": newIdentifier("idempotencyRecord"),
        },
        body: JSON.stringify({ circuitBreaker }),
      });
      expect(response.status).toBe(422);
    }
  });
});
