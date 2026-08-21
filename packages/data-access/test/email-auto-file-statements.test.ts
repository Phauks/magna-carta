import { beforeEach, describe, expect, it } from "vitest";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type {
  EmailAutoFileDecisionId,
  EmailAutoFileRuleId,
  EmailMatterLinkId,
  EmailMessageId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  createEmailAutoFileRule,
  insertEmailAutoFileDecisionStatement,
  readActiveAutoFileRulesByMatchValues,
  readAutoFileDecisionsForMessage,
  readAutoFileRuleActivity,
  readAutoFileRuleById,
  readAutoFileRulesByIds,
  readAutoFileRulesForMatter,
  readAutoFileRuleMatterIds,
  readAutomaticRuleTallies,
  findAutoFileRuleByMatch,
  resumeEmailAutoFileRule,
  revokeEmailAutoFileRule,
  suspendEmailAutoFileRule,
  updateEmailAutoFileRulePromotion,
  type AutoFileRuleAuditOptions,
} from "../src/email-auto-file-statements.ts";
import type { BatchDatabase } from "../src/effect-batch.ts";

const NOW = "2026-08-05T22:00:00.000Z";
const ACTOR = "user_actor00000000000" as UserId;
const RULE = "emailAutoFileRule_aaa" as EmailAutoFileRuleId;

type Raw = import("node:sqlite").DatabaseSync;
let database: BatchDatabase;
let raw: Raw;

const auditOptions: AutoFileRuleAuditOptions = {
  clock: { now: () => NOW },
  actorUserId: ACTOR,
};

beforeEach(() => {
  const migrated = createMigratedNodeDatabase("per-firm");
  database = migrated.database as unknown as BatchDatabase;
  raw = migrated.raw;
});

function seedMatter(suffix: string): MatterId {
  const userId = `user_${suffix}`;
  const matterId = `matter_${suffix}`;
  raw
    .prepare(
      `INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at)
       VALUES (?, 'Test User', 'active', 0, ?)`,
    )
    .run(userId, NOW);
  raw
    .prepare(
      `INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at)
       VALUES (?, 'Test Matter', 'open', ?, 0, ?, ?)`,
    )
    .run(matterId, userId, NOW, NOW);
  return matterId as MatterId;
}

function seedMessage(id: string): EmailMessageId {
  raw
    .prepare(
      "INSERT OR IGNORE INTO email_thread (id, first_seen_at, created_at, updated_at) VALUES (?, ?, ?, ?)",
    )
    .run("emailThread_a", NOW, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO email_message
         (id, message_id_provenance, received_at, thread_id, content_sha256, dedup_key,
          original_r2_key, integrity, source_format, captured_via, created_at, updated_at)
       VALUES (?, 'header', ?, 'emailThread_a', ?, ?, ?, '{}', 'eml', 'addin', ?, ?)`,
    )
    .run(id, NOW, `sha-${id}`, `messageId:<${id}>`, `emails/${id}/original`, NOW, NOW);
  return id as EmailMessageId;
}

async function run(statements: readonly unknown[]): Promise<void> {
  await database.batch(statements as never);
}

function auditRows(): { event: string; subject_id: string | null; metadata: string | null }[] {
  return (
    raw
      // Insertion order, not id order: an audit-log id is a random handle, so only the rowid carries
      // the sequence these were written in.
      .prepare("SELECT event, subject_id, metadata FROM audit_log ORDER BY rowid ASC")
      .all() as never
  );
}

function ruleStateOf(id: string): { state: string; suspended_reason: string | null } {
  return raw
    .prepare("SELECT state, suspended_reason FROM email_auto_file_rule WHERE id = ?")
    .get(id) as never;
}

async function createRule(
  matterId: MatterId,
  overrides: Partial<Parameters<typeof createEmailAutoFileRule>[1]> = {},
): Promise<EmailAutoFileRuleId> {
  const write = createEmailAutoFileRule(
    database,
    {
      id: RULE,
      kind: "correspondentMatter",
      matterId,
      matchValue: "counsel@opposing.example",
      promotion: "stage",
      createdBy: ACTOR,
      createdFromEmailMessageId: null,
      ...overrides,
    },
    auditOptions,
  );
  await run(write.statements);
  return overrides.id ?? RULE;
}

describe("the rule mutations", () => {
  it("creates a rule active, with its authorizing act recorded, and audits it", async () => {
    const matterId = seedMatter("one0000000000000000");
    const messageId = seedMessage("emailMessage_a");
    await createRule(matterId, { createdFromEmailMessageId: messageId });

    const [row] = await readAutoFileRulesForMatter(database, matterId, 10);
    expect(row?.state).toBe("active");
    expect(row?.suspendedReason).toBeNull();
    expect(row?.createdFromEmailMessageId).toBe(messageId);

    const audits = auditRows();
    expect(audits).toHaveLength(1);
    expect(audits[0]?.event).toBe("emails.autoFileRule.created");
    expect(audits[0]?.subject_id).toBe(RULE);
    // Identifiers and enums only — never the match value, which is a person's mailbox.
    expect(audits[0]?.metadata).not.toContain("@");
  });

  it("audits every mutation, one row apiece", async () => {
    const matterId = seedMatter("two0000000000000000");
    await createRule(matterId);
    await run(
      updateEmailAutoFileRulePromotion(database, { id: RULE, promotion: "file" }, auditOptions)
        .statements,
    );
    await run(
      suspendEmailAutoFileRule(database, { id: RULE, reason: "blastBound" }, auditOptions)
        .statements,
    );
    await run(resumeEmailAutoFileRule(database, { id: RULE }, auditOptions).statements);
    await run(revokeEmailAutoFileRule(database, { id: RULE }, auditOptions).statements);

    expect(auditRows().map((audit) => audit.event)).toEqual([
      "emails.autoFileRule.created",
      "emails.autoFileRule.updated",
      "emails.autoFileRule.suspended",
      "emails.autoFileRule.resumed",
      "emails.autoFileRule.revoked",
    ]);
  });

  it("suspends with its reason and resumes clearing it, so no rule carries a stale reason", async () => {
    const matterId = seedMatter("three00000000000000");
    await createRule(matterId);
    await run(
      suspendEmailAutoFileRule(database, { id: RULE, reason: "undoRate" }, auditOptions).statements,
    );
    expect(ruleStateOf(RULE)).toEqual({ state: "suspended", suspended_reason: "undoRate" });
    await run(resumeEmailAutoFileRule(database, { id: RULE }, auditOptions).statements);
    expect(ruleStateOf(RULE)).toEqual({ state: "active", suspended_reason: null });
  });

  it("does not rewrite the original reason when the same rule is suspended twice", async () => {
    const matterId = seedMatter("four000000000000000");
    await createRule(matterId);
    await run(
      suspendEmailAutoFileRule(database, { id: RULE, reason: "blastBound" }, auditOptions)
        .statements,
    );
    await run(
      suspendEmailAutoFileRule(database, { id: RULE, reason: "member" }, auditOptions).statements,
    );
    expect(ruleStateOf(RULE).suspended_reason).toBe("blastBound");
  });

  it("does not re-arm a suspended rule through a promotion edit", async () => {
    const matterId = seedMatter("five000000000000000");
    await createRule(matterId);
    await run(
      suspendEmailAutoFileRule(database, { id: RULE, reason: "matterClosed" }, auditOptions)
        .statements,
    );
    await run(
      updateEmailAutoFileRulePromotion(database, { id: RULE, promotion: "file" }, auditOptions)
        .statements,
    );
    const promotion = raw
      .prepare("SELECT promotion, state FROM email_auto_file_rule WHERE id = ?")
      .get(RULE) as { promotion: string; state: string };
    expect(promotion).toEqual({ promotion: "stage", state: "suspended" });
  });

  it("revoking is not deleting — the row stays, so the ledger naming it stays explicable", async () => {
    const matterId = seedMatter("six0000000000000000");
    await createRule(matterId);
    await run(revokeEmailAutoFileRule(database, { id: RULE }, auditOptions).statements);
    expect(ruleStateOf(RULE)).toEqual({ state: "revoked", suspended_reason: null });
    // Revoked rules are out of the matter's working list.
    expect(await readAutoFileRulesForMatter(database, matterId, 10)).toEqual([]);
  });
});

describe("the fire-time lookup", () => {
  it("resolves candidates by match value and returns only active rules", async () => {
    const matterId = seedMatter("seven00000000000000");
    await createRule(matterId);
    await createRule(matterId, {
      id: "emailAutoFileRule_bbb" as EmailAutoFileRuleId,
      matchValue: "clerk@court.example",
    });
    await run(
      suspendEmailAutoFileRule(
        database,
        { id: "emailAutoFileRule_bbb" as EmailAutoFileRuleId, reason: "member" },
        auditOptions,
      ).statements,
    );

    const hits = await readActiveAutoFileRulesByMatchValues(database, "correspondentMatter", [
      "counsel@opposing.example",
      "clerk@court.example",
    ]);
    expect(hits.map((hit) => hit.id)).toEqual([RULE]);
  });

  it("does not cross rule kinds — one column, meaning fixed by kind", async () => {
    const matterId = seedMatter("eight00000000000000");
    await createRule(matterId);
    expect(
      await readActiveAutoFileRulesByMatchValues(database, "threadContinuation", [
        "counsel@opposing.example",
      ]),
    ).toEqual([]);
  });

  it("issues no statement at all for a message that matched nothing", async () => {
    expect(await readActiveAutoFileRulesByMatchValues(database, "correspondentMatter", [])).toEqual(
      [],
    );
  });

  it("walks the (kind, match_value) index rather than scanning the rule table", () => {
    const plan = raw
      .prepare(
        `EXPLAIN QUERY PLAN SELECT id FROM email_auto_file_rule
         WHERE kind = ? AND match_value IN (?) AND state = 'active' ORDER BY id ASC`,
      )
      .all("correspondentMatter", "counsel@opposing.example") as { detail: string }[];
    const details = plan.map((row) => row.detail);
    expect(details.some((detail) => detail.includes("email_auto_file_rule_kind_match"))).toBe(true);
    expect(details.some((detail) => detail.startsWith("SCAN") && !detail.includes(" USING "))).toBe(
      false,
    );
  });

  it("cannot be diverted onto the suspension index, which covers only rules out of service", () => {
    // A full index on the three-value state column would be preferred here over the match-value
    // walk, turning the capture path's one read into a walk of every active rule in the firm.
    const suspensionIndex = raw
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'email_auto_file_rule_state_index'")
      .get() as { sql: string };
    expect(suspensionIndex.sql).toContain("!= 'active'");
  });
});

describe("the decision ledger", () => {
  it("records a suppression with its reason and no matter", async () => {
    const messageId = seedMessage("emailMessage_a");
    await run([
      insertEmailAutoFileDecisionStatement(
        database,
        {
          id: "emailAutoFileDecision_a" as EmailAutoFileDecisionId,
          emailMessageId: messageId,
          autoFileRuleId: null,
          matterId: null,
          outcome: "suppressed",
          suppressionReason: "ambiguousEvidence",
          evidence: { decidingMatterCount: 2 },
        },
        NOW,
      ),
    ]);
    const [row] = await readAutoFileDecisionsForMessage(database, messageId, 10);
    expect(row?.outcome).toBe("suppressed");
    expect(row?.suppressionReason).toBe("ambiguousEvidence");
    expect(row?.matterId).toBeNull();
    expect(row?.evidence).toBe('{"decidingMatterCount":2}');
  });

  it("records a firing naming the rule that produced it, with no message content anywhere", async () => {
    const matterId = seedMatter("nine000000000000000");
    const messageId = seedMessage("emailMessage_a");
    await createRule(matterId);
    await run([
      insertEmailAutoFileDecisionStatement(
        database,
        {
          id: "emailAutoFileDecision_a" as EmailAutoFileDecisionId,
          emailMessageId: messageId,
          autoFileRuleId: RULE,
          matterId,
          outcome: "staged",
          suppressionReason: null,
          evidence: { ruleKind: "correspondentMatter", demotionReason: "rulePosture" },
        },
        NOW,
      ),
    ]);
    const rows = raw.prepare("SELECT * FROM email_auto_file_decision").all() as Record<
      string,
      unknown
    >[];
    for (const value of Object.values(rows[0] ?? {})) {
      if (typeof value !== "string") continue;
      expect(value).not.toContain("@");
      expect(value.toLowerCase()).not.toContain("subject");
    }
  });
});

describe("the per-rule activity derivation", () => {
  async function recordFiring(index: number, matterId: MatterId): Promise<EmailMessageId> {
    const messageId = seedMessage(`emailMessage_${index}`);
    await run([
      insertEmailAutoFileDecisionStatement(
        database,
        {
          id: `emailAutoFileDecision_${index}` as EmailAutoFileDecisionId,
          emailMessageId: messageId,
          autoFileRuleId: RULE,
          matterId,
          outcome: "filed",
          suppressionReason: null,
          evidence: {},
        },
        `2026-08-05T22:0${index}:00.000Z`,
      ),
    ]);
    raw
      .prepare(
        `INSERT INTO email_matter_link
           (id, email_message_id, matter_id, state, captured_via, auto_file_rule_id, created_at, updated_at)
         VALUES (?, ?, ?, 'filed', 'addin', ?, ?, ?)`,
      )
      .run(`emailMatterLink_${index}` as EmailMatterLinkId, messageId, matterId, RULE, NOW, NOW);
    return messageId;
  }

  it("counts the rule's firings inside the window and stops at the cap", async () => {
    const matterId = seedMatter("ten0000000000000000");
    await createRule(matterId);
    for (let index = 0; index < 6; index += 1) await recordFiring(index, matterId);

    const activity = await readAutoFileRuleActivity(database, {
      autoFileRuleId: RULE,
      windowStart: "2026-08-05T21:00:00.000Z",
      windowLimit: 4,
      recentFireWindow: 10,
    });
    // Bounded: the read never walks more than the cap, because a rule firing past it is exactly the
    // rule the breaker is about to stop.
    expect(activity.firesInWindow).toBe(4);
  });

  it("excludes firings from before the window", async () => {
    const matterId = seedMatter("elev000000000000000");
    await createRule(matterId);
    for (let index = 0; index < 3; index += 1) await recordFiring(index, matterId);

    const activity = await readAutoFileRuleActivity(database, {
      autoFileRuleId: RULE,
      windowStart: "2026-08-05T22:02:00.000Z",
      windowLimit: 50,
      recentFireWindow: 10,
    });
    expect(activity.firesInWindow).toBe(1);
  });

  it("counts an undo of the rule's own filing as a reversal", async () => {
    const matterId = seedMatter("twel000000000000000");
    await createRule(matterId);
    const first = await recordFiring(0, matterId);
    await recordFiring(1, matterId);
    await recordFiring(2, matterId);
    // The undo is the ordinary unlink route, unchanged — the link flips to unlinked.
    raw
      .prepare("UPDATE email_matter_link SET state = 'unlinked' WHERE email_message_id = ?")
      .run(first);

    const activity = await readAutoFileRuleActivity(database, {
      autoFileRuleId: RULE,
      windowStart: "2026-08-05T21:00:00.000Z",
      windowLimit: 50,
      recentFireWindow: 10,
    });
    expect(activity.firesInWindow).toBe(3);
    expect(activity.undosInRecentFires).toBe(1);
  });

  it("reports nothing for a rule that has never fired", async () => {
    const matterId = seedMatter("thir000000000000000");
    await createRule(matterId);
    const activity = await readAutoFileRuleActivity(database, {
      autoFileRuleId: RULE,
      windowStart: "2026-08-05T21:00:00.000Z",
      windowLimit: 50,
      recentFireWindow: 10,
    });
    expect(activity).toEqual({ firesInWindow: 0, undosInRecentFires: 0, recentFireCount: 0 });
  });

  it("walks the (auto_file_rule_id, created_at) index rather than scanning the ledger", () => {
    const plan = raw
      .prepare(
        `EXPLAIN QUERY PLAN SELECT outcome, created_at FROM email_auto_file_decision
         WHERE auto_file_rule_id = ? AND created_at >= ? AND outcome IN ('filed', 'staged')
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(RULE, NOW, 25) as { detail: string }[];
    const details = plan.map((row) => row.detail);
    expect(details.some((detail) => detail.includes("email_auto_file_decision_rule_created"))).toBe(
      true,
    );
    expect(details.some((detail) => detail.startsWith("SCAN") && !detail.includes(" USING "))).toBe(
      false,
    );
  });
});

describe("the reads the management surface is built on", () => {
  it("reads one rule by handle, INCLUDING a revoked one", async () => {
    const matterId = seedMatter("four1000000000000000");
    await createRule(matterId);
    await run(revokeEmailAutoFileRule(database, { id: RULE }, auditOptions).statements);
    // The matter list omits it — a member pruning rules should not see retired ones — but the
    // by-handle read must still answer, or a link a revoked rule made becomes unexplainable and
    // every transition route would 404 instead of saying the rule is already revoked.
    expect(await readAutoFileRulesForMatter(database, matterId, 10)).toEqual([]);
    expect((await readAutoFileRuleById(database, RULE))?.state).toBe("revoked");
  });

  it("answers null for a handle no rule carries", async () => {
    expect(
      await readAutoFileRuleById(database, "emailAutoFileRule_zzz" as EmailAutoFileRuleId),
    ).toBeNull();
  });

  it("finds an existing rule by its exact condition, so a duplicate is reported rather than thrown", async () => {
    const matterId = seedMatter("four2000000000000000");
    await createRule(matterId);
    expect(
      (
        await findAutoFileRuleByMatch(database, {
          kind: "correspondentMatter",
          matchValue: "counsel@opposing.example",
          matterId,
        })
      )?.id,
    ).toBe(RULE);
    // The same address on a different matter is a DIFFERENT rule — the unique index is on all three
    // columns, and a client legitimately corresponds about more than one matter.
    const otherMatter = seedMatter("four3000000000000000");
    expect(
      await findAutoFileRuleByMatch(database, {
        kind: "correspondentMatter",
        matchValue: "counsel@opposing.example",
        matterId: otherMatter,
      }),
    ).toBeNull();
  });

  it("hydrates a bounded set of rules by handle and nothing else", async () => {
    const matterId = seedMatter("four4000000000000000");
    await createRule(matterId);
    const second = "emailAutoFileRule_bbb" as EmailAutoFileRuleId;
    await createRule(matterId, { id: second, matchValue: "clerk@court.example" });
    expect((await readAutoFileRulesByIds(database, [RULE])).map((rule) => rule.id)).toEqual([RULE]);
    expect(await readAutoFileRulesByIds(database, [])).toEqual([]);
    expect((await readAutoFileRulesByIds(database, [RULE, second])).map((rule) => rule.id)).toEqual(
      [RULE, second].sort((left, right) => left.localeCompare(right)),
    );
  });
});

describe("the review read's walk over automatic links", () => {
  function seedLink(input: {
    index: number;
    matterId: MatterId;
    state: "staged" | "filed" | "unlinked";
    automatic: boolean;
    createdAt: string;
  }): void {
    const messageId = seedMessage(`emailMessage_link_${input.index}`);
    raw
      .prepare(
        `INSERT INTO email_matter_link
           (id, email_message_id, matter_id, state, captured_via, auto_file_rule_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'forward', ?, ?, ?)`,
      )
      .run(
        `emailMatterLink_${input.index}` as EmailMatterLinkId,
        messageId,
        input.matterId,
        input.state,
        input.automatic ? RULE : null,
        input.createdAt,
        input.createdAt,
      );
  }

  const WINDOW = "2026-08-05T21:00:00.000Z";

  // A person's link is not review material, and counting it would misreport how much of a matter's
  // correspondence arrived unattended — which is the one number this read exists to give a firm.
  it("counts only the links a rule made", async () => {
    const matterId = seedMatter("five1000000000000000");
    await createRule(matterId);
    seedLink({ index: 1, matterId, state: "staged", automatic: true, createdAt: NOW });
    seedLink({ index: 2, matterId, state: "filed", automatic: false, createdAt: NOW });

    const touched = await readAutoFileRuleMatterIds(database, { limit: 50 });
    expect(touched.matterIds).toEqual([matterId]);
    expect(touched.capped).toBe(false);

    const tallies = await readAutomaticRuleTallies(database, {
      since: WINDOW,
      matterIds: touched.matterIds,
    });
    expect(tallies).toHaveLength(1);
    // The person's `filed` link is absent from the count, not merely absent from a list.
    expect(tallies[0]).toMatchObject({ autoFileRuleId: RULE, stagedCount: 1, filedCount: 0 });
  });

  it("stays inside its window, and counts every link in it however many there are", async () => {
    const matterId = seedMatter("five2000000000000000");
    await createRule(matterId);
    seedLink({
      index: 3,
      matterId,
      state: "filed",
      automatic: true,
      createdAt: "2026-07-01T00:00:00.000Z",
    });
    seedLink({ index: 4, matterId, state: "filed", automatic: true, createdAt: NOW });
    seedLink({
      index: 5,
      matterId,
      state: "unlinked",
      automatic: true,
      createdAt: "2026-08-05T22:30:00.000Z",
    });

    const tallies = await readAutomaticRuleTallies(database, {
      since: WINDOW,
      matterIds: [matterId],
    });
    // The July link is outside the window and is not counted; the two inside it are, by state.
    expect(tallies[0]).toMatchObject({ filedCount: 1, undoneCount: 1, stagedCount: 0 });
    // The latest act in the window, so a caller sorting by it sorts by most-recent activity.
    expect(tallies[0]?.lastActedAt).toBe("2026-08-05T22:30:00.000Z");
  });

  // The ceiling is on the matters the firm has set RULES on, and the reason it says so is the defect
  // this read was rebuilt to remove: a cap that quietly narrows the answer is one a firm cannot tell
  // from a quiet month.
  it("reports the matter ceiling rather than narrowing in silence", async () => {
    const first = seedMatter("five3000000000000000");
    const second = seedMatter("five4000000000000000");
    await createRule(first);
    await createRule(second, { id: "emailAutoFileRule_second00000000000" as EmailAutoFileRuleId });

    const cut = await readAutoFileRuleMatterIds(database, { limit: 1 });
    expect(cut.matterIds).toHaveLength(1);
    expect(cut.capped).toBe(true);
    expect((await readAutoFileRuleMatterIds(database, { limit: 2 })).capped).toBe(false);
  });

  // A count is a sum and a sum merges, which is what makes chunking the matter list at D1's
  // bound-parameter cap safe: two chunks' tallies for one rule add up to what one query would give.
  it("merges tallies across chunked matter lists", async () => {
    const first = seedMatter("five5000000000000000");
    const second = seedMatter("five6000000000000000");
    await createRule(first);
    seedLink({ index: 8, matterId: first, state: "filed", automatic: true, createdAt: NOW });
    seedLink({
      index: 9,
      matterId: second,
      state: "filed",
      automatic: true,
      createdAt: "2026-08-05T22:45:00.000Z",
    });

    const together = await readAutomaticRuleTallies(database, {
      since: WINDOW,
      matterIds: [first, second],
    });
    expect(together[0]).toMatchObject({ filedCount: 2 });
    expect(together[0]?.lastActedAt).toBe("2026-08-05T22:45:00.000Z");
  });

  // Taking the matter set from the RULES rather than from the links is what keeps this read off the
  // link table entirely — the rule catalog is the firm's own configuration, and reading all of it is
  // the same cost class as reading any settings list.
  it("takes its matter set from the rule catalog, never from the links", () => {
    const plan = raw
      .prepare(
        `EXPLAIN QUERY PLAN SELECT DISTINCT matter_id FROM email_auto_file_rule
         ORDER BY matter_id ASC LIMIT ?`,
      )
      .all(50) as { detail: string }[];
    expect(
      plan.map((row) => row.detail).some((detail) => detail.includes("email_matter_link")),
    ).toBe(false);
  });

  // The count is the only part that touches the links, and it must seek per matter inside the window
  // rather than walk the firm's mail — this is a read a person loads a screen with.
  it("counts one rule's window from the matter-scoped index, never a scan", () => {
    const plan = raw
      .prepare(
        `EXPLAIN QUERY PLAN SELECT auto_file_rule_id,
                SUM(CASE WHEN state = 'filed' THEN 1 ELSE 0 END) AS filed_count,
                MAX(created_at) AS last_acted_at
           FROM email_matter_link
          WHERE auto_file_rule_id IS NOT NULL AND created_at >= ? AND matter_id IN (?, ?)
          GROUP BY auto_file_rule_id`,
      )
      .all(NOW, "a", "b") as { detail: string }[];
    const details = plan.map((row) => row.detail);
    expect(details.some((detail) => detail.startsWith("SEARCH"))).toBe(true);
    expect(details.some((detail) => detail.startsWith("SCAN") && !detail.includes(" USING "))).toBe(
      false,
    );
  });

  it("serves the undo derivation's subquery from that same index", () => {
    const plan = raw
      .prepare(
        `EXPLAIN QUERY PLAN SELECT email_message_id FROM email_matter_link
         WHERE auto_file_rule_id = ? AND state = 'unlinked'`,
      )
      .all(RULE) as { detail: string }[];
    const details = plan.map((row) => row.detail);
    expect(
      details.some((detail) => detail.includes("email_matter_link_auto_file_rule_created_index")),
    ).toBe(true);
    expect(details.some((detail) => detail.startsWith("SCAN") && !detail.includes(" USING "))).toBe(
      false,
    );
  });

  // The index is deliberately PARTIAL: a firm with no rules must pay nothing for it, and it must
  // never grow with the links people make by hand.
  it("indexes only the automatic links", () => {
    const definition = raw
      .prepare(
        "SELECT sql FROM sqlite_master WHERE name = 'email_matter_link_auto_file_rule_created_index'",
      )
      .get() as { sql: string };
    expect(definition.sql).toContain("IS NOT NULL");
  });
});
