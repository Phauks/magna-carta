import {
  readActiveAutoFileRulesByMatchValues,
  readAutoFileRuleActivity,
  type EmailAutoFileRuleRow,
} from "@magna-carta/data-access/email-auto-file-statements";
import {
  readEmailMatterLinksForMessage,
  readFiledMattersForThreads,
} from "@magna-carta/data-access/email-filing-statements";
import {
  resolveAutoFileDecision,
  activityWindowLimitFor,
  NO_AUTO_FILE_RULE_MATCHED,
  type AutoFileCandidateRule,
  type AutoFileCircuitBreakerThresholds,
  type AutoFileDecision,
  type AutoFileEvidence,
} from "@magna-carta/email-filing/auto-file-rules";
import type { AutoFileEvaluationRequest } from "@magna-carta/email-filing/capture";
import { candidateMatterNumbers } from "@magna-carta/email-filing/matter-suggestion";
import type { MatterId } from "@magna-carta/identifiers/types";
import { findMattersByNumbers, readMatterFilingTargets } from "@magna-carta/matters/queries";
import type { ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";
import {
  readAutoFileCircuitBreaker,
  readAutoFileDirectFilingPermitted,
} from "./auto-file-policy.ts";
import { filterAccessibleMatters } from "./matter-access.ts";

// Gather what the guardrail function needs, then let it decide. The split is the one
// matter-suggestion.ts established and the reason the whole decision is testable with no database:
// everything that touches the firm's data lives here, and everything that weighs it is pure.
//
// The read budget per capture is fixed and small — a rule lookup by match value, the thread's filed
// matters, the subject's matter numbers, the message's existing links, the target matters' state, the
// wall answer for the delegating members, the firm ceiling, and one activity walk per candidate rule.
// None of it scales with the firm's rule count (rules are found BY match value, never scanned), with
// the firm's mail volume (it is per message), or with the thread's length (the thread is resolved by
// identifier). And the whole thing runs on a queue consumer, not in a request handler.

// The rolling window the circuit breaker measures a rule's firing rate over.
const ACTIVITY_WINDOW_MILLISECONDS = 60 * 60 * 1000;

export interface AutoFileEvaluationDependencies {
  readonly firmDatabase: ProxyBatchDatabase;
  readonly now: () => string;
}

// Build the capture core's auto-file port over one firm's database. Returned as a closure rather than
// exported as a bare function so the consumer wires it once, beside its other ports, and nothing else
// can reach the evaluation with a database handle for a different firm.
export function createAutoFileDecisionPort(
  dependencies: AutoFileEvaluationDependencies,
): (request: AutoFileEvaluationRequest) => Promise<AutoFileDecision> {
  return (request) => evaluateAutoFileRules(dependencies, request);
}

export async function evaluateAutoFileRules(
  dependencies: AutoFileEvaluationDependencies,
  request: AutoFileEvaluationRequest,
): Promise<AutoFileDecision> {
  const { firmDatabase } = dependencies;

  // The rule lookup comes FIRST and short-circuits, which is what keeps the evaluation ledger
  // proportional to rule activity rather than to the firm's mail volume: a firm with no rules on this
  // sender and no rule on this thread pays two indexed lookups per capture and nothing else, and
  // writes no ledger row at all.
  const [correspondentRules, threadRules] = await Promise.all([
    request.fromAddress === null
      ? Promise.resolve<EmailAutoFileRuleRow[]>([])
      : readActiveAutoFileRulesByMatchValues(firmDatabase, "correspondentMatter", [
          request.fromAddress,
        ]),
    readActiveAutoFileRulesByMatchValues(firmDatabase, "threadContinuation", [request.threadId]),
  ]);
  const ruleRows = [...correspondentRules, ...threadRules];
  if (ruleRows.length === 0) return NO_AUTO_FILE_RULE_MATCHED;

  // The circuit-breaker thresholds are read here, with the other firm-level answers, because the
  // activity walk below is bounded BY them — the fire threshold sets the walk's cap and the
  // recent-fire window sets the undo denominator.
  const [threadHits, subjectMatters, existingLinks, firmDirectFilingPermitted, circuitBreaker] =
    await Promise.all([
      readFiledMattersForThreads(firmDatabase, [request.threadId]),
      findMattersByNumbers(firmDatabase, candidateMatterNumbers(request.subject)),
      readEmailMatterLinksForMessage(firmDatabase, request.emailMessageId),
      readAutoFileDirectFilingPermitted(firmDatabase),
      readAutoFileCircuitBreaker(firmDatabase),
    ]);

  const threadMatterIds = [...new Set(threadHits.map((hit) => hit.matterId))];
  const subjectMatterIds = [...new Set(subjectMatters.map((matter) => matter.id))];

  // Every matter the precise evidence names. The guardrail function refuses outright when this set
  // holds more than one, so it is also the set for which a conflict answer can ever matter.
  const decidingMatterIds = [
    ...new Set<MatterId>([
      ...ruleRows.map((rule) => rule.matterId),
      ...threadMatterIds,
      ...subjectMatterIds,
    ]),
  ];

  const [targetMatters, accessByRuleId, activityByRuleId] = await Promise.all([
    readMatterFilingTargets(firmDatabase, decidingMatterIds),
    resolveCreatorAccess(firmDatabase, ruleRows),
    resolveRuleActivity(dependencies, ruleRows, circuitBreaker),
  ]);

  const evidence: AutoFileEvidence = {
    matchedRules: ruleRows.map((rule): AutoFileCandidateRule => ({
      ruleId: rule.id,
      kind: rule.kind,
      matterId: rule.matterId,
      matchValue: rule.matchValue,
      promotion: rule.promotion,
      state: rule.state,
      creatorRetainsMatterAccess: accessByRuleId.get(rule.id) ?? null,
      firesInWindow: activityByRuleId.get(rule.id)?.firesInWindow ?? 0,
      undosInRecentFires: activityByRuleId.get(rule.id)?.undosInRecentFires ?? 0,
    })),
    threadMatterIds,
    subjectMatterIds,
    existingLinks,
    dkimVerdict: request.dkimVerdict,
    capturedVia: request.capturedVia,
    dkimVerifiedDomain: request.dkimVerifiedDomain,
    dkimBodyFullyCovered: request.dkimBodyFullyCovered,
    targetMatters: targetMatters.map((matter) => ({
      matterId: matter.id,
      status: matter.status,
      systemOwned: matter.systemOwned,
    })),
    // Asked only where a single matter could actually be filed to. With more than one the evidence is
    // ambiguous and nothing fires regardless, so putting the question would be work with no answer to
    // give — and the hook is the capture core's to call, which is why it arrives as a closure.
    conflictHold:
      decidingMatterIds.length === 1 && decidingMatterIds[0] !== undefined
        ? request.conflictHoldFor(decidingMatterIds[0])
        : false,
    firmDirectFilingPermitted,
    circuitBreaker,
  };

  return resolveAutoFileDecision(evidence);
}

// Does each rule's delegating member still hold access to the matter the rule names? A rule is a
// delegated act, so it may only keep acting while the person who delegated it could still perform it
// themselves — access is withdrawn as well as granted, and a durable rule must not outlive its
// authorization.
//
// Grouped by member so the number of wall questions is bounded by the distinct delegators on this
// message's rules, not by the rule count. A rule with no recorded creator answers `null` — unknown,
// which the guardrails read as "not permitted now" without claiming access was withdrawn.
async function resolveCreatorAccess(
  firmDatabase: ProxyBatchDatabase,
  rules: readonly EmailAutoFileRuleRow[],
): Promise<Map<string, boolean | null>> {
  const mattersByCreator = new Map<string, Set<MatterId>>();
  for (const rule of rules) {
    if (rule.createdBy === null) continue;
    const matters = mattersByCreator.get(rule.createdBy) ?? new Set<MatterId>();
    matters.add(rule.matterId);
    mattersByCreator.set(rule.createdBy, matters);
  }
  const visibleByCreator = new Map<string, Set<MatterId>>();
  await Promise.all(
    [...mattersByCreator].map(async ([createdBy, matters]) => {
      const visible = await filterAccessibleMatters({ firmDatabase }, createdBy, [...matters]);
      visibleByCreator.set(createdBy, new Set(visible));
    }),
  );
  const accessByRuleId = new Map<string, boolean | null>();
  for (const rule of rules) {
    accessByRuleId.set(
      rule.id,
      rule.createdBy === null
        ? null
        : (visibleByCreator.get(rule.createdBy)?.has(rule.matterId) ?? null),
    );
  }
  return accessByRuleId;
}

// Each candidate rule's recent behaviour — how often it has fired inside the rolling window, and how
// many of its recent firings a person has since undone. Both are derived from the evaluation ledger
// by a bounded index walk rather than kept as counters on the rule row, which would put two contended
// writes on every capture to buy a number this read produces off the request path.
async function resolveRuleActivity(
  dependencies: AutoFileEvaluationDependencies,
  rules: readonly EmailAutoFileRuleRow[],
  circuitBreaker: AutoFileCircuitBreakerThresholds,
): Promise<Map<string, { firesInWindow: number; undosInRecentFires: number }>> {
  const windowStart = new Date(
    new Date(dependencies.now()).getTime() - ACTIVITY_WINDOW_MILLISECONDS,
  ).toISOString();
  const entries = await Promise.all(
    rules.map(async (rule) => {
      const activity = await readAutoFileRuleActivity(dependencies.firmDatabase, {
        autoFileRuleId: rule.id,
        windowStart,
        // The limit must sit above the breaker's threshold or the reported count could never reach
        // it — the domain package derives this value from the firm's threshold for exactly that
        // reason, so a firm raising the threshold widens the walk with it.
        windowLimit: activityWindowLimitFor(circuitBreaker),
        recentFireWindow: circuitBreaker.recentFireWindow,
      });
      return [
        rule.id,
        {
          firesInWindow: activity.firesInWindow,
          undosInRecentFires: activity.undosInRecentFires,
        },
      ] as const;
    }),
  );
  return new Map(entries);
}
