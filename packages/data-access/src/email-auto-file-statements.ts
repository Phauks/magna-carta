import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  EmailAutoFileDecisionId,
  EmailAutoFileRuleId,
  EmailMessageId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { domainAuditStatement } from "./audit-statements.ts";
import { canonicalJsonStringify } from "./canonical.ts";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync fitness
// test. Both tables exist only in the per-firm database — the caller supplies that handle.
export const EMAIL_AUTO_FILE_RULE_TABLE = "email_auto_file_rule";
export const EMAIL_AUTO_FILE_DECISION_TABLE = "email_auto_file_decision";

// The rule's own vocabulary. Declared here rather than imported from the domain package so
// data-access stays a foundational layer; @magna-carta/email-filing produces structurally-identical
// values and the schema's CHECK constraints are the third agreeing home.
export type AutoFileRuleKind = "threadContinuation" | "correspondentMatter";
export type AutoFileRulePromotion = "stage" | "file";
export type AutoFileRuleState = "active" | "suspended" | "revoked";
export type AutoFileRuleSuspendedReason =
  | "creatorAccessWithdrawn"
  | "matterClosed"
  | "blastBound"
  | "undoRate"
  | "member";
export type AutoFileDecisionOutcome = "filed" | "staged" | "suppressed";
export type AutoFileDecisionSuppressionReason =
  | "ambiguousEvidence"
  | "creatorAccessWithdrawn"
  | "senderNotAuthenticated"
  | "signatureFailed"
  | "humanFilingDecision"
  | "matterNotOpen"
  | "ruleNotActive"
  | "incompleteEvidence";

// Wall-clock and actor arrive from the caller — these statements read no clock and trust no ambient
// identity. randomSource lets fixtures mint byte-deterministic audit ids.
export interface AutoFileRuleAuditOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}

// A mutation and the audit row that records it, to be composed into one effect batch. Returned as a
// pair rather than executed here: the caller owns the batch, and an audit row the same commit cannot
// carry means the mutation must not succeed.
export interface AutoFileRuleWrite {
  readonly statements: readonly SqlStatement[];
}

function audit(
  database: SqlDatabase,
  options: AutoFileRuleAuditOptions,
  event: string,
  subjectId: string,
  metadata: unknown,
): SqlStatement {
  return domainAuditStatement(database, {
    event,
    subjectId,
    actorUserId: options.actorUserId,
    clock: options.clock,
    randomSource: options.randomSource,
    metadata,
  });
}

export interface EmailAutoFileRuleInsert {
  readonly id: EmailAutoFileRuleId;
  readonly kind: AutoFileRuleKind;
  readonly matterId: MatterId;
  // The normalized From address for a correspondent rule, the thread identifier for a thread rule.
  readonly matchValue: string;
  readonly promotion: AutoFileRulePromotion;
  readonly createdBy: UserId | null;
  // The manual filing that occasioned the offer, where there was one — the rule's authorizing act.
  readonly createdFromEmailMessageId: EmailMessageId | null;
}

// Create a rule. A new rule is always `active` with no suspension reason: the two states the check
// constraint pairs are set together, never independently.
export function createEmailAutoFileRule(
  database: SqlDatabase,
  input: EmailAutoFileRuleInsert,
  options: AutoFileRuleAuditOptions,
): AutoFileRuleWrite {
  const now = options.clock.now();
  return {
    statements: [
      database
        .prepare(
          `INSERT INTO ${EMAIL_AUTO_FILE_RULE_TABLE}
             (id, kind, matter_id, match_value, promotion, state, suspended_reason, created_by,
              created_from_email_message_id, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, 'active', NULL, ?6, ?7, ?8, ?8)`,
        )
        .bind(
          input.id,
          input.kind,
          input.matterId,
          input.matchValue,
          input.promotion,
          input.createdBy,
          input.createdFromEmailMessageId,
          now,
        ),
      // Identifiers and enums only — never the match value, which for a correspondent rule is a
      // person's mailbox.
      audit(database, options, "emails.autoFileRule.created", input.id, {
        matterId: input.matterId,
        kind: input.kind,
        promotion: input.promotion,
      }),
    ],
  };
}

// Change what a rule is allowed to do with the link it produces. Guarded on `active`: a suspended or
// revoked rule is not quietly re-armed by a promotion edit.
export function updateEmailAutoFileRulePromotion(
  database: SqlDatabase,
  input: { id: EmailAutoFileRuleId; promotion: AutoFileRulePromotion },
  options: AutoFileRuleAuditOptions,
): AutoFileRuleWrite {
  const now = options.clock.now();
  return {
    statements: [
      database
        .prepare(
          `UPDATE ${EMAIL_AUTO_FILE_RULE_TABLE}
           SET promotion = ?1, updated_at = ?2
           WHERE id = ?3 AND state = 'active'`,
        )
        .bind(input.promotion, now, input.id),
      audit(database, options, "emails.autoFileRule.updated", input.id, {
        promotion: input.promotion,
      }),
    ],
  };
}

// Take a rule out of service, with its reason. Suspension is never deletion: a suspended rule with
// its history explains what had been filing, and a deleted one leaves the firm unable to say. Guarded
// on `active` so a repeat suspension (a retry, two captures tripping the same breaker) does not
// rewrite the original reason.
export function suspendEmailAutoFileRule(
  database: SqlDatabase,
  input: { id: EmailAutoFileRuleId; reason: AutoFileRuleSuspendedReason },
  options: AutoFileRuleAuditOptions,
): AutoFileRuleWrite {
  const now = options.clock.now();
  return {
    statements: [
      database
        .prepare(
          `UPDATE ${EMAIL_AUTO_FILE_RULE_TABLE}
           SET state = 'suspended', suspended_reason = ?1, updated_at = ?2
           WHERE id = ?3 AND state = 'active'`,
        )
        .bind(input.reason, now, input.id),
      audit(database, options, "emails.autoFileRule.suspended", input.id, {
        suspendedReason: input.reason,
      }),
    ],
  };
}

// Put a suspended rule back in service. Clears the reason in the same statement, because the check
// constraint pairs the two and a resumed rule carrying a stale reason would be a lie about why it
// once stopped. Never resurrects a revoked rule.
export function resumeEmailAutoFileRule(
  database: SqlDatabase,
  input: { id: EmailAutoFileRuleId },
  options: AutoFileRuleAuditOptions,
): AutoFileRuleWrite {
  const now = options.clock.now();
  return {
    statements: [
      database
        .prepare(
          `UPDATE ${EMAIL_AUTO_FILE_RULE_TABLE}
           SET state = 'active', suspended_reason = NULL, updated_at = ?1
           WHERE id = ?2 AND state = 'suspended'`,
        )
        .bind(now, input.id),
      audit(database, options, "emails.autoFileRule.resumed", input.id, null),
    ],
  };
}

// Retire a rule for good. Still not a delete: the ledger rows naming it stay explicable, which is the
// whole reason the decision table carries a rule reference at all.
export function revokeEmailAutoFileRule(
  database: SqlDatabase,
  input: { id: EmailAutoFileRuleId },
  options: AutoFileRuleAuditOptions,
): AutoFileRuleWrite {
  const now = options.clock.now();
  return {
    statements: [
      database
        .prepare(
          `UPDATE ${EMAIL_AUTO_FILE_RULE_TABLE}
           SET state = 'revoked', suspended_reason = NULL, updated_at = ?1
           WHERE id = ?2 AND state != 'revoked'`,
        )
        .bind(now, input.id),
      audit(database, options, "emails.autoFileRule.revoked", input.id, null),
    ],
  };
}

export interface EmailAutoFileRuleRow {
  readonly id: EmailAutoFileRuleId;
  readonly kind: AutoFileRuleKind;
  readonly matterId: MatterId;
  readonly matchValue: string;
  readonly promotion: AutoFileRulePromotion;
  readonly state: AutoFileRuleState;
  readonly suspendedReason: AutoFileRuleSuspendedReason | null;
  readonly createdBy: UserId | null;
  readonly createdFromEmailMessageId: EmailMessageId | null;
  readonly createdAt: string;
}

// One home for the projection and its row mapping, so every read of this table returns the same shape
// and a new column cannot be added to one query and forgotten in another.
const SELECT_RULE_COLUMNS = `SELECT id, kind, matter_id, match_value, promotion, state, suspended_reason, created_by, created_from_email_message_id, created_at FROM ${EMAIL_AUTO_FILE_RULE_TABLE}`;

interface RuleResultRow {
  id: string;
  kind: string;
  matter_id: string;
  match_value: string;
  promotion: string;
  state: string;
  suspended_reason: string | null;
  created_by: string | null;
  created_from_email_message_id: string | null;
  created_at: string;
}

function toRuleRow(row: RuleResultRow): EmailAutoFileRuleRow {
  return {
    id: row.id as EmailAutoFileRuleId,
    kind: row.kind as AutoFileRuleKind,
    matterId: row.matter_id as MatterId,
    matchValue: row.match_value,
    promotion: row.promotion as AutoFileRulePromotion,
    state: row.state as AutoFileRuleState,
    suspendedReason: row.suspended_reason as AutoFileRuleSuspendedReason | null,
    createdBy: row.created_by as UserId | null,
    createdFromEmailMessageId: row.created_from_email_message_id as EmailMessageId | null,
    createdAt: row.created_at,
  };
}

// The fire-time lookup, and the reason evaluation cost does not scale with the firm's rule count: a
// capture resolves its candidates by MATCH VALUE on (kind, match_value), never by scanning the rule
// table. The caller passes the handful of values one message can match — one normalized From address,
// one resolved thread — so the parameter list is bounded by the message, not by the firm.
export async function readActiveAutoFileRulesByMatchValues(
  database: SqlDatabase,
  kind: AutoFileRuleKind,
  matchValues: readonly string[],
): Promise<EmailAutoFileRuleRow[]> {
  if (matchValues.length === 0) return [];
  const placeholders = matchValues.map(() => "?").join(", ");
  const { results } = await database
    .prepare(
      `${SELECT_RULE_COLUMNS}
       WHERE kind = ? AND match_value IN (${placeholders}) AND state = 'active'
       ORDER BY id ASC`,
    )
    .bind(kind, ...matchValues)
    .all<RuleResultRow>();
  return results.map(toRuleRow);
}

// A matter's rules, for the list a member prunes. Served by the matter index.
export async function readAutoFileRulesForMatter(
  database: SqlDatabase,
  matterId: MatterId,
  limit: number,
): Promise<EmailAutoFileRuleRow[]> {
  const { results } = await database
    .prepare(
      `${SELECT_RULE_COLUMNS}
       WHERE matter_id = ?1 AND state != 'revoked'
       ORDER BY created_at DESC, id DESC
       LIMIT ?2`,
    )
    .bind(matterId, limit)
    .all<RuleResultRow>();
  return results.map(toRuleRow);
}

// One rule by handle, INCLUDING a revoked one. Every mutation route reads this first, because the
// matter the rule names is what the caller's access is checked against, and because a rule that is
// already revoked must be answered as such rather than silently re-mutated: the mutation statements
// are all guarded on state, so without this read a revoke of a revoked rule would return success over
// a write that changed nothing.
export async function readAutoFileRuleById(
  database: SqlDatabase,
  id: EmailAutoFileRuleId,
): Promise<EmailAutoFileRuleRow | null> {
  const { results } = await database
    .prepare(`${SELECT_RULE_COLUMNS} WHERE id = ?1`)
    .bind(id)
    .all<RuleResultRow>();
  const row = results[0];
  return row === undefined ? null : toRuleRow(row);
}

// The rules behind a bounded set of handles — the hydration half of the review read, which resolves
// its rules from the links it already found rather than listing the firm's rules and joining back.
// Revoked rules are included on purpose: a link a revoked rule made still has to be able to say which
// rule made it.
export async function readAutoFileRulesByIds(
  database: SqlDatabase,
  ids: readonly EmailAutoFileRuleId[],
): Promise<EmailAutoFileRuleRow[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const { results } = await database
    .prepare(`${SELECT_RULE_COLUMNS} WHERE id IN (${placeholders}) ORDER BY id ASC`)
    .bind(...ids)
    .all<RuleResultRow>();
  return results.map(toRuleRow);
}

// Is this exact rule already on the books? The unique index refuses a duplicate at write time, but a
// caller deserves the reason rather than a constraint violation — and a rule that was revoked and is
// being created again is a different answer from one that is live, so the row itself is returned.
export async function findAutoFileRuleByMatch(
  database: SqlDatabase,
  input: { kind: AutoFileRuleKind; matchValue: string; matterId: MatterId },
): Promise<EmailAutoFileRuleRow | null> {
  const { results } = await database
    .prepare(`${SELECT_RULE_COLUMNS} WHERE kind = ?1 AND match_value = ?2 AND matter_id = ?3`)
    .bind(input.kind, input.matchValue, input.matterId)
    .all<RuleResultRow>();
  const row = results[0];
  return row === undefined ? null : toRuleRow(row);
}

// D1 caps bound parameters at 100 per query. Restated rather than imported because this package is
// the foundational layer and `@magna-carta/ledger` — where the shared constant lives — sits above it;
// packages/conflicts/src/matching.ts and packages/directory/src/edges.ts restate it for the same
// reason. The node:sqlite test substrate allows far more, so an oversized IN-list would pass every
// local test and fail only against production D1.
const MAX_BOUND_PARAMETERS = 100;

// THE REVIEW READ, IN TWO PARTS, AND THE SPLIT IS WHAT MAKES ITS NUMBERS TRUE.
//
// The review answers "what have this firm's rules actually been doing" as a count per rule, and a
// count is only worth reading if it is exact. It was computed by walking a capped page of links and
// tallying them in application code, which broke twice past that cap: every count understated, and a
// matter whose links all fell past the cut vanished from the answer entirely — not undercounted,
// absent, because the matter set handed to the wall filter came from the same truncated page.
//
// So: take the matter set from the RULES, let the caller put it through the wall, then count in SQL
// over the matters that survived. The ceiling moves off links — which grow with every message a rule
// files — and onto the firm's own rule catalog, and the counting has no ceiling at all.
//
// The count is served by the (matter_id, created_at) index, so it seeks per matter inside the window
// rather than walking the firm's mail. NEITHER READ IS PAGED, and that is deliberate rather than
// unfinished: a cursor over a set the wall can shrink hands out short pages and calls it the end of
// the list.

export interface AutoFileRuleMatters {
  readonly matterIds: MatterId[];
  /** True when the firm holds rules on more matters than one answer carries. */
  readonly capped: boolean;
}

/**
 * The distinct matters this firm has auto-file rules on — every state, revoked included.
 *
 * THE MATTER SET COMES FROM THE RULES, NOT FROM THE LINKS, and that is the whole repair. A rule is
 * bound to one matter, so the rules name every matter a rule could possibly have filed to; taking
 * the set from a capped page of links instead meant a matter whose links all fell past the cut was
 * absent from the review entirely. It also puts the ceiling on a quantity a PERSON controls — how
 * many matters the firm has set rules on — rather than on one that activity drives.
 *
 * Revoked rules are included because a rule that filed for three weeks and was then stopped is
 * precisely what a reviewer is looking for; a rule with no activity in the window simply produces no
 * tally and no entry.
 *
 * The caller puts these through the wall before anything else is read, so a rule on a matter the
 * caller cannot open contributes no entry and no count — it never enters the answer rather than
 * being filtered out of a rendered one.
 */
export async function readAutoFileRuleMatterIds(
  database: SqlDatabase,
  input: { limit: number },
): Promise<AutoFileRuleMatters> {
  const { results } = await database
    .prepare(
      `SELECT DISTINCT matter_id FROM ${EMAIL_AUTO_FILE_RULE_TABLE} ORDER BY matter_id ASC LIMIT ?1`,
    )
    // One over the ceiling, purely to tell "exactly at it" from "past it".
    .bind(input.limit + 1)
    .all<{ matter_id: string }>();
  const capped = results.length > input.limit;
  return {
    capped,
    matterIds: (capped ? results.slice(0, input.limit) : results).map(
      (row) => row.matter_id as MatterId,
    ),
  };
}

export interface AutomaticRuleTally {
  readonly autoFileRuleId: EmailAutoFileRuleId;
  readonly filedCount: number;
  readonly stagedCount: number;
  readonly undoneCount: number;
  readonly lastActedAt: string;
}

/**
 * What each rule did over the window, counted in SQL over the matters the caller may see.
 *
 * Chunked at the bound-parameter cap and merged, because a count is a sum and a sum merges: adding
 * two chunks' tallies for one rule gives the same number one query would have. The merge takes the
 * later `lastActedAt` for the same reason.
 *
 * The link state carries the CURRENT truth — a filing somebody has since taken off reads as
 * `unlinked` — which is what a reviewer is looking at, and it is the same signal the circuit
 * breaker's undo input is derived from, so the two cannot tell a firm different stories about one
 * rule.
 */
export async function readAutomaticRuleTallies(
  database: SqlDatabase,
  input: { since: string; matterIds: readonly MatterId[] },
): Promise<AutomaticRuleTally[]> {
  const merged = new Map<EmailAutoFileRuleId, AutomaticRuleTally>();
  // One bind is spent on `since`, so a chunk carries one fewer matter than the cap allows.
  const chunkSize = MAX_BOUND_PARAMETERS - 1;
  for (let offset = 0; offset < input.matterIds.length; offset += chunkSize) {
    const chunk = input.matterIds.slice(offset, offset + chunkSize);
    const placeholders = chunk.map(() => "?").join(", ");
    const { results } = await database
      .prepare(
        `SELECT auto_file_rule_id,
                SUM(CASE WHEN state = 'filed' THEN 1 ELSE 0 END) AS filed_count,
                SUM(CASE WHEN state = 'staged' THEN 1 ELSE 0 END) AS staged_count,
                SUM(CASE WHEN state = 'unlinked' THEN 1 ELSE 0 END) AS undone_count,
                MAX(created_at) AS last_acted_at
           FROM email_matter_link
          WHERE auto_file_rule_id IS NOT NULL AND created_at >= ? AND matter_id IN (${placeholders})
          GROUP BY auto_file_rule_id`,
      )
      .bind(input.since, ...chunk)
      .all<{
        auto_file_rule_id: string;
        filed_count: number;
        staged_count: number;
        undone_count: number;
        last_acted_at: string;
      }>();
    for (const row of results) {
      const ruleId = row.auto_file_rule_id as EmailAutoFileRuleId;
      const existing = merged.get(ruleId);
      merged.set(ruleId, {
        autoFileRuleId: ruleId,
        filedCount: (existing?.filedCount ?? 0) + row.filed_count,
        stagedCount: (existing?.stagedCount ?? 0) + row.staged_count,
        undoneCount: (existing?.undoneCount ?? 0) + row.undone_count,
        lastActedAt:
          existing !== undefined && existing.lastActedAt > row.last_acted_at
            ? existing.lastActedAt
            : row.last_acted_at,
      });
    }
  }
  return [...merged.values()];
}

export interface EmailAutoFileDecisionInsert {
  readonly id: EmailAutoFileDecisionId;
  readonly emailMessageId: EmailMessageId;
  // Null where the outcome is attributable to the evidence rather than to any one rule.
  readonly autoFileRuleId: EmailAutoFileRuleId | null;
  readonly matterId: MatterId | null;
  readonly outcome: AutoFileDecisionOutcome;
  readonly suppressionReason: AutoFileDecisionSuppressionReason | null;
  // Identifiers and enums ONLY. Never a subject, an address, or a display name — the plain-language
  // sentences a person reads are rendered from these at read time, exactly as the suggestion
  // machinery renders its reasons.
  readonly evidence: unknown;
}

// Record one evaluation. Written only where something happened — a rule matched, or a match was
// suppressed — so the table stays proportional to rule activity rather than to the firm's mail
// volume. It rides the same batch as the capture write, so a response body can never claim a decision
// that rolled back.
export function insertEmailAutoFileDecisionStatement(
  database: SqlDatabase,
  input: EmailAutoFileDecisionInsert,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${EMAIL_AUTO_FILE_DECISION_TABLE}
         (id, email_message_id, auto_file_rule_id, matter_id, outcome, suppression_reason, evidence, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(
      input.id,
      input.emailMessageId,
      input.autoFileRuleId,
      input.matterId,
      input.outcome,
      input.suppressionReason,
      canonicalJsonStringify(input.evidence ?? {}),
      now,
    );
}

export interface EmailAutoFileDecisionRow {
  readonly id: EmailAutoFileDecisionId;
  readonly emailMessageId: EmailMessageId;
  readonly autoFileRuleId: EmailAutoFileRuleId | null;
  readonly matterId: MatterId | null;
  readonly outcome: AutoFileDecisionOutcome;
  readonly suppressionReason: AutoFileDecisionSuppressionReason | null;
  readonly evidence: string;
  readonly createdAt: string;
}

const SELECT_DECISION_COLUMNS = `SELECT id, email_message_id, auto_file_rule_id, matter_id, outcome, suppression_reason, evidence, created_at FROM ${EMAIL_AUTO_FILE_DECISION_TABLE}`;

interface DecisionResultRow {
  id: string;
  email_message_id: string;
  auto_file_rule_id: string | null;
  matter_id: string | null;
  outcome: string;
  suppression_reason: string | null;
  evidence: string;
  created_at: string;
}

function toDecisionRow(row: DecisionResultRow): EmailAutoFileDecisionRow {
  return {
    id: row.id as EmailAutoFileDecisionId,
    emailMessageId: row.email_message_id as EmailMessageId,
    autoFileRuleId: row.auto_file_rule_id as EmailAutoFileRuleId | null,
    matterId: row.matter_id as MatterId | null,
    outcome: row.outcome as AutoFileDecisionOutcome,
    suppressionReason: row.suppression_reason as AutoFileDecisionSuppressionReason | null,
    evidence: row.evidence,
    createdAt: row.created_at,
  };
}

// "Why did this message file itself" — one message's decision history, newest first and bounded.
export async function readAutoFileDecisionsForMessage(
  database: SqlDatabase,
  emailMessageId: EmailMessageId,
  limit: number,
): Promise<EmailAutoFileDecisionRow[]> {
  const { results } = await database
    .prepare(
      `${SELECT_DECISION_COLUMNS}
       WHERE email_message_id = ?1
       ORDER BY created_at DESC, id DESC
       LIMIT ?2`,
    )
    .bind(emailMessageId, limit)
    .all<DecisionResultRow>();
  return results.map(toDecisionRow);
}

export interface AutoFileRuleActivity {
  // Filings this rule produced inside the window — the circuit breaker's input.
  readonly firesInWindow: number;
  // How many of the rule's most recent firings have since been reversed — the undo-rate input.
  readonly undosInRecentFires: number;
  readonly recentFireCount: number;
}

// The bounded per-rule fire/undo derivation, and the reason no counter is maintained on the rule row:
// two contended hot-path writes would buy a number this index walk produces off the request path.
//
// One walk of (auto_file_rule_id, created_at) from the window's start, capped — a rule firing far more
// often than the cap is exactly the rule the breaker is about to stop, and reading more of its
// firings would not change that answer.
//
// `windowLimit` CAPS THE COUNT THIS REPORTS, so it must sit strictly above the breaker's threshold or
// the reported count can never reach it and the breaker is disabled with nothing to see. The value to
// pass is `AUTO_FILE_ACTIVITY_WINDOW_LIMIT` from @magna-carta/email-filing, which is derived from the
// threshold for exactly this reason; it is not imported here because that would invert the dependency
// between the data-access layer and the domain package that owns the rule.
//
// An undo is read off the link's own state, because the undo IS the ordinary unlink route and that
// route is unchanged: a link the rule made and somebody removed is a reversal, whoever removed it.
export async function readAutoFileRuleActivity(
  database: SqlDatabase,
  input: {
    autoFileRuleId: EmailAutoFileRuleId;
    windowStart: string;
    windowLimit: number;
    recentFireWindow: number;
  },
): Promise<AutoFileRuleActivity> {
  const { results } = await database
    .prepare(
      `SELECT outcome, created_at FROM ${EMAIL_AUTO_FILE_DECISION_TABLE}
       WHERE auto_file_rule_id = ?1 AND created_at >= ?2 AND outcome IN ('filed', 'staged')
       ORDER BY created_at DESC, id DESC
       LIMIT ?3`,
    )
    .bind(input.autoFileRuleId, input.windowStart, input.windowLimit)
    .all<{ outcome: string; created_at: string }>();
  const firesInWindow = results.length;
  const { results: reversals } = await database
    .prepare(
      // Distinct MESSAGES, not decision rows: a message the rule was asked about twice is one
      // filing a person undid once, and counting it twice would trip the feedback loop early.
      `SELECT COUNT(DISTINCT email_message_id) AS reversal_count FROM ${EMAIL_AUTO_FILE_DECISION_TABLE}
       WHERE auto_file_rule_id = ?1
         AND outcome IN ('filed', 'staged')
         AND email_message_id IN (
           SELECT email_message_id FROM ${EMAIL_AUTO_FILE_DECISION_TABLE}
           WHERE auto_file_rule_id = ?1 AND outcome IN ('filed', 'staged')
           ORDER BY created_at DESC, id DESC
           LIMIT ?2
         )
         AND email_message_id IN (
           SELECT email_message_id FROM email_matter_link
           WHERE auto_file_rule_id = ?1 AND state = 'unlinked'
         )`,
    )
    .bind(input.autoFileRuleId, input.recentFireWindow)
    .all<{ reversal_count: number }>();
  return {
    firesInWindow,
    undosInRecentFires: reversals[0]?.reversal_count ?? 0,
    recentFireCount: Math.min(firesInWindow, input.recentFireWindow),
  };
}
