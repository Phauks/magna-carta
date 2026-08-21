import { describe, expect, it } from "vitest";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import {
  readActiveAutoFileRulesByMatchValues,
  readAutoFileRuleActivity,
  readAutoFileRuleMatterIds,
  readAutomaticRuleTallies,
} from "@magna-carta/data-access/email-auto-file-statements";
import {
  readEmailMatterLinksForMessage,
  readFiledMattersForThreads,
} from "@magna-carta/data-access/email-filing-statements";
import { findMattersByNumbers } from "@magna-carta/matters/queries";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type {
  EmailAutoFileRuleId,
  EmailMessageId,
  EmailThreadId,
  MatterId,
} from "@magna-carta/identifiers/types";
import { explainStatement, findFullScans, runMeasurements, type LabeledPlan } from "./runner.ts";

// The auto-file engine's cost per capture, measured where its claims can actually be falsified.
//
// The claims are three, and each one is a property that would quietly become false rather than
// visibly break: the per-capture cost does not scale with the firm's RULE COUNT (the fire-time lookup
// is by match value, never a scan), it does not scale with a conversation's LENGTH, and the circuit
// breaker's activity walk stays bounded no matter how far a runaway rule has already run.
//
// Two of the three hold as stated. The middle one holds only for the RULE lookup; the read beside it
// grows with the conversation, and the measurement below reports that rather than restating the
// claim — see the comment on that case.
//
// Following the harness convention: the numbers are PRINTED, never asserted against a threshold —
// they are machine-relative and decide regressions across commits, not absolute latencies. What is
// ASSERTED is plan shape and result cardinality, both of which are timing-noise-free. A rule lookup
// that became a scan would show up here as a plan change, on a machine of any speed.

const NOW = "2026-08-19T12:00:00.000Z";
const WINDOW_START = "2026-08-19T11:00:00.000Z";

// The firm the flat-cost claim is made about. Ten thousand rules across a thousand matters is the
// population the claim names; the small firm beside it is the control.
const LARGE_RULE_COUNT = 10_000;
const LARGE_MATTER_COUNT = 1_000;
const SMALL_RULE_COUNT = 10;
// A conversation long enough that walking it would be visible against resolving it by identifier.
const LONG_THREAD_MESSAGE_COUNT = 2_000;
// A rule firing far past the breaker's default of twenty-five in a rolling hour.
const BURST_FIRE_COUNT = 200;
// The cap the activity walk carries. Above the breaker's threshold on purpose: a walk capped BELOW
// the threshold could never report a count that reaches it, and the breaker would read as configured
// while never tripping.
const ACTIVITY_WINDOW_LIMIT = 26;
const RECENT_FIRE_WINDOW = 10;

const PROBE_ADDRESS = "counsel@opposing.test";
const PROBE_THREAD = "emailThread_probe" as EmailThreadId;
const PROBE_RULE = "emailAutoFileRule_probe" as EmailAutoFileRuleId;

interface SeededFirm {
  readonly database: SqlDatabase;
  readonly raw: import("node:sqlite").DatabaseSync;
  readonly probeMatterId: MatterId;
  readonly probeMessageId: EmailMessageId;
  readonly close: () => void;
}

interface VolumeShape {
  readonly ruleCount: number;
  readonly matterCount: number;
  readonly threadMessageCount: number;
  readonly burstFireCount: number;
}

function seedFirm(shape: VolumeShape): SeededFirm {
  const migrated = createMigratedNodeDatabase("per-firm");
  const raw = migrated.raw;
  const database = migrated.database as unknown as SqlDatabase;

  raw
    .prepare(
      `INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at)
       VALUES ('user_af', 'Auto File', 'active', 0, ?)`,
    )
    .run(NOW);

  const insertMatter = raw.prepare(
    `INSERT INTO matter (id, title, status, matter_number, responsible_member_id, e_billing, created_at, updated_at)
     VALUES (?, 'M', 'open', ?, 'user_af', 0, ?, ?)`,
  );
  const matterIds: MatterId[] = [];
  for (let index = 0; index < shape.matterCount; index += 1) {
    const matterId = `matter_af_${index}` as MatterId;
    insertMatter.run(matterId, `2026-${String(index).padStart(6, "0")}`, NOW, NOW);
    matterIds.push(matterId);
  }
  const probeMatterId = matterIds[0]!;

  // The rule population. Every one is a real candidate the fire-time lookup could return; the probe
  // rule is the one a capture actually matches, and it sits at an arbitrary position in the table so
  // finding it can never be an accident of insertion order.
  const insertRule = raw.prepare(
    `INSERT INTO email_auto_file_rule
       (id, kind, matter_id, match_value, promotion, state, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'stage', 'active', 'user_af', ?, ?)`,
  );
  for (let index = 0; index < shape.ruleCount; index += 1) {
    insertRule.run(
      `emailAutoFileRule_af_${index}`,
      index % 2 === 0 ? "correspondentMatter" : "threadContinuation",
      matterIds[index % matterIds.length]!,
      index % 2 === 0 ? `person${index}@example.test` : `emailThread_af_${index}`,
      NOW,
      NOW,
    );
  }
  insertRule.run(PROBE_RULE, "correspondentMatter", probeMatterId, PROBE_ADDRESS, NOW, NOW);
  insertRule.run(
    "emailAutoFileRule_probe_thread",
    "threadContinuation",
    probeMatterId,
    PROBE_THREAD,
    NOW,
    NOW,
  );

  // The conversation. Every message is filed to the probe matter, which is the thread-continuation
  // condition in its true form and also the worst case for the thread read: one matter, many rows.
  raw
    .prepare(
      "INSERT INTO email_thread (id, subject_normalized, first_seen_at, created_at, updated_at) VALUES (?, 's', ?, ?, ?)",
    )
    .run(PROBE_THREAD, NOW, NOW, NOW);
  const insertMessage = raw.prepare(
    `INSERT INTO email_message
       (id, message_id_value, message_id_provenance, subject, received_at, thread_id, content_sha256,
        dedup_key, original_r2_key, references_remote_content, integrity, dkim_verdict, source_format,
        captured_via, from_address, created_at, updated_at)
     VALUES (?, ?, 'header', 'S', ?, ?, ?, ?, ?, 0, '{}', 'unverified', 'eml', 'forward', ?, ?, ?)`,
  );
  const insertLink = raw.prepare(
    `INSERT INTO email_matter_link
       (id, email_message_id, matter_id, state, captured_via, auto_file_rule_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'forward', ?, ?, ?)`,
  );
  for (let index = 0; index < shape.threadMessageCount; index += 1) {
    const messageId = `emailMessage_af_${index}`;
    insertMessage.run(
      messageId,
      `<af-${index}@example.test>`,
      NOW,
      PROBE_THREAD,
      `sha-af-${index}`,
      `messageId:header:<af-${index}@example.test>`,
      `emails/${messageId}/original`,
      PROBE_ADDRESS,
      NOW,
      NOW,
    );
    insertLink.run(
      `emailMatterLink_af_${index}`,
      messageId,
      probeMatterId,
      "filed",
      null,
      NOW,
      NOW,
    );
  }
  const probeMessageId = "emailMessage_af_0" as EmailMessageId;

  // The runaway rule's history: firings inside the window, plus the automatic links they made — the
  // undo derivation reads the links, so a burst has to leave both behind to be measured honestly.
  const insertDecision = raw.prepare(
    `INSERT INTO email_auto_file_decision
       (id, email_message_id, auto_file_rule_id, matter_id, outcome, suppression_reason, evidence, created_at)
     VALUES (?, ?, ?, ?, 'filed', NULL, '{}', ?)`,
  );
  for (let index = 0; index < shape.burstFireCount; index += 1) {
    const messageId = `emailMessage_burst_${index}`;
    insertMessage.run(
      messageId,
      `<burst-${index}@example.test>`,
      NOW,
      PROBE_THREAD,
      `sha-burst-${index}`,
      `messageId:header:<burst-${index}@example.test>`,
      `emails/${messageId}/original`,
      PROBE_ADDRESS,
      NOW,
      NOW,
    );
    insertLink.run(
      `emailMatterLink_burst_${index}`,
      messageId,
      probeMatterId,
      // A tenth of them taken back off by a person — the undo feedback the breaker's second input
      // reads, and the reason the walk has to touch the link table at all.
      index % 10 === 0 ? "unlinked" : "filed",
      PROBE_RULE,
      NOW,
      NOW,
    );
    insertDecision.run(
      `emailAutoFileDecision_af_${index}`,
      messageId,
      PROBE_RULE,
      probeMatterId,
      NOW,
    );
  }

  return { database, raw, probeMatterId, probeMessageId, close: () => raw.close() };
}

// Exactly the reads the evidence gatherer issues for one capture. Named as one unit because the claim
// under test is about the WHOLE per-capture addition, not about any single statement.
async function gatherEvidenceOnce(firm: SeededFirm): Promise<void> {
  const correspondentRules = await readActiveAutoFileRulesByMatchValues(
    firm.database,
    "correspondentMatter",
    [PROBE_ADDRESS],
  );
  const threadRules = await readActiveAutoFileRulesByMatchValues(
    firm.database,
    "threadContinuation",
    [PROBE_THREAD],
  );
  if (correspondentRules.length + threadRules.length === 0) return;
  await Promise.all([
    readFiledMattersForThreads(firm.database, [PROBE_THREAD]),
    findMattersByNumbers(firm.database, ["2026-000000"]),
    readEmailMatterLinksForMessage(firm.database, firm.probeMessageId),
    readAutoFileRuleActivity(firm.database, {
      autoFileRuleId: PROBE_RULE,
      windowStart: WINDOW_START,
      windowLimit: ACTIVITY_WINDOW_LIMIT,
      recentFireWindow: RECENT_FIRE_WINDOW,
    }),
  ]);
}

function hotPathPlans(raw: import("node:sqlite").DatabaseSync): LabeledPlan[] {
  return [
    {
      label: "fire-time rule lookup by match value",
      details: explainStatement(
        raw,
        `SELECT id FROM email_auto_file_rule
         WHERE kind = ? AND match_value IN (?) AND state = 'active' ORDER BY id ASC`,
        ["correspondentMatter", PROBE_ADDRESS],
      ),
    },
    {
      label: "thread's filed matters",
      details: explainStatement(
        raw,
        `SELECT email_matter_link.matter_id AS matter_id, email_message.thread_id AS thread_id,
                MAX(email_matter_link.created_at) AS last_filed_at
         FROM email_message
         JOIN email_matter_link ON email_matter_link.email_message_id = email_message.id
         WHERE email_message.thread_id IN (?) AND email_matter_link.state = 'filed'
         GROUP BY email_matter_link.matter_id, email_message.thread_id
         ORDER BY last_filed_at DESC`,
        [PROBE_THREAD],
      ),
    },
    {
      label: "circuit-breaker activity walk",
      details: explainStatement(
        raw,
        `SELECT outcome, created_at FROM email_auto_file_decision
         WHERE auto_file_rule_id = ? AND created_at >= ? AND outcome IN ('filed', 'staged')
         ORDER BY created_at DESC, id DESC LIMIT ?`,
        [PROBE_RULE, WINDOW_START, ACTIVITY_WINDOW_LIMIT],
      ),
    },
    {
      label: "undo derivation over the rule's own links",
      details: explainStatement(
        raw,
        `SELECT email_message_id FROM email_matter_link
         WHERE auto_file_rule_id = ? AND state = 'unlinked'`,
        [PROBE_RULE],
      ),
    },
    {
      label: "review read over recent automatic links",
      details: explainStatement(
        raw,
        `SELECT email_message_id, matter_id, auto_file_rule_id, state, created_at
         FROM email_matter_link
         WHERE auto_file_rule_id IS NOT NULL AND created_at >= ?
         ORDER BY created_at DESC, id DESC LIMIT ?`,
        [WINDOW_START, 500],
      ),
    },
  ];
}

// The load-profile convention: report, never gate. A ratio printed beside the two numbers is what a
// reader compares across commits.
function report(label: string, results: readonly { name: string; medianMs: number }[]): void {
  const lines = results.map((result) => `${result.name}=${result.medianMs}ms`).join("  ");
  console.log(`[auto-file load profile] ${label}: ${lines}`);
}

describe("auto-file rules at volume (load profile)", () => {
  it("adds only bounded index walks to a capture, whatever the firm's rule population", async () => {
    const small = seedFirm({
      ruleCount: SMALL_RULE_COUNT,
      matterCount: 20,
      threadMessageCount: 20,
      burstFireCount: 5,
    });
    const large = seedFirm({
      ruleCount: LARGE_RULE_COUNT,
      matterCount: LARGE_MATTER_COUNT,
      threadMessageCount: 20,
      burstFireCount: 5,
    });
    try {
      // THE ASSERTION: plan shape, on the large firm, where a scan would actually hurt. A rule
      // lookup that stopped using (kind, match_value) is the one regression that would make the
      // flat-cost claim false, and it is invisible in a timing on a fast machine with a warm cache.
      expect(findFullScans(hotPathPlans(large.raw))).toEqual([]);

      // THE NUMBERS: the whole per-capture addition, at ten rules and at ten thousand.
      const results = await runMeasurements(
        undefined,
        [
          {
            name: `gather@${SMALL_RULE_COUNT}rules`,
            operation: async () => await gatherEvidenceOnce(small),
          },
          {
            name: `gather@${LARGE_RULE_COUNT}rules`,
            operation: async () => await gatherEvidenceOnce(large),
          },
        ],
        { warmupIterations: 5, iterations: 25 },
      );
      report("rule population", results);

      // The lookup returns the ONE rule that matches, at either population — which is the
      // cardinality half of the flat-cost claim and is noise-free.
      for (const firm of [small, large]) {
        expect(
          await readActiveAutoFileRulesByMatchValues(firm.database, "correspondentMatter", [
            PROBE_ADDRESS,
          ]),
        ).toHaveLength(1);
      }
    } finally {
      small.close();
      large.close();
    }
  }, 60_000);

  // MEASURED, AND THE CLAIM IS NARROWER THAN IT READS. The rule lookup for a thread really is by
  // identifier and really is flat. The read beside it — the thread's already-filed matters — is a join
  // over every message in the conversation grouped down to its matters, so it grows with the thread:
  // on this machine, 0.06 ms at eight messages and 1.9 ms at two thousand. That is well inside a queue
  // consumer's budget and it is the same read the suggestion endpoint already issues inside a REQUEST
  // budget, so it is not a problem to fix; it is a sentence to keep true. What must not change is the
  // plan — an index walk producing one row per matter, not per message.
  it("resolves a long conversation without a scan, and reports what growing it costs", async () => {
    const shortThread = seedFirm({
      ruleCount: SMALL_RULE_COUNT,
      matterCount: 20,
      threadMessageCount: 8,
      burstFireCount: 5,
    });
    const longThread = seedFirm({
      ruleCount: SMALL_RULE_COUNT,
      matterCount: 20,
      threadMessageCount: LONG_THREAD_MESSAGE_COUNT,
      burstFireCount: 5,
    });
    try {
      expect(findFullScans(hotPathPlans(longThread.raw))).toEqual([]);

      const results = await runMeasurements(
        undefined,
        [
          {
            name: "thread@8messages",
            operation: async () => {
              await readFiledMattersForThreads(shortThread.database, [PROBE_THREAD]);
            },
          },
          {
            name: `thread@${LONG_THREAD_MESSAGE_COUNT}messages`,
            operation: async () => {
              await readFiledMattersForThreads(longThread.database, [PROBE_THREAD]);
            },
          },
        ],
        { warmupIterations: 5, iterations: 25 },
      );
      report("thread length", results);

      // A thread's messages are all on one matter, so the ANSWER is one row however long the
      // conversation runs — the read hands the guardrails a matter, never a message list. The rows
      // it reads to produce that answer are the conversation, which is what the numbers above show.
      expect(await readFiledMattersForThreads(longThread.database, [PROBE_THREAD])).toHaveLength(1);
    } finally {
      shortThread.close();
      longThread.close();
    }
  }, 120_000);

  it("keeps the circuit breaker's read bounded however far a runaway rule has already run", async () => {
    const burst = seedFirm({
      ruleCount: SMALL_RULE_COUNT,
      matterCount: 20,
      threadMessageCount: 20,
      burstFireCount: BURST_FIRE_COUNT,
    });
    try {
      expect(findFullScans(hotPathPlans(burst.raw))).toEqual([]);

      // THE ASSERTION, and it is the point of the whole guardrail: two hundred firings inside the
      // window report as the CAP, not as two hundred. The walk is what runs on the capture path, so
      // a rule that has run away must not make every subsequent capture read its whole history —
      // and the reported count still reaches the threshold, which is what makes the breaker trip.
      const activity = await readAutoFileRuleActivity(burst.database, {
        autoFileRuleId: PROBE_RULE,
        windowStart: WINDOW_START,
        windowLimit: ACTIVITY_WINDOW_LIMIT,
        recentFireWindow: RECENT_FIRE_WINDOW,
      });
      expect(activity.firesInWindow).toBe(ACTIVITY_WINDOW_LIMIT);
      expect(activity.firesInWindow).toBeGreaterThan(25);
      expect(activity.undosInRecentFires).toBeLessThanOrEqual(RECENT_FIRE_WINDOW);

      const results = await runMeasurements(
        undefined,
        [
          {
            name: `activityWalk@${BURST_FIRE_COUNT}fires`,
            operation: async () => {
              await readAutoFileRuleActivity(burst.database, {
                autoFileRuleId: PROBE_RULE,
                windowStart: WINDOW_START,
                windowLimit: ACTIVITY_WINDOW_LIMIT,
                recentFireWindow: RECENT_FIRE_WINDOW,
              });
            },
          },
          {
            // Both halves of the review read, in the order the route runs them — the matter set from
            // the rule catalog, then the counts over it. Measuring only one half would measure the
            // cheap one: the counting is what touches the link table.
            name: "reviewRead@30days",
            operation: async () => {
              const matters = await readAutoFileRuleMatterIds(burst.database, { limit: 500 });
              await readAutomaticRuleTallies(burst.database, {
                since: WINDOW_START,
                matterIds: matters.matterIds,
              });
            },
          },
        ],
        { warmupIterations: 5, iterations: 25 },
      );
      report("burst", results);
    } finally {
      burst.close();
    }
  }, 60_000);
});
