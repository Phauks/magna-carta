// Deciding whether the platform may file a captured message onto a matter with nobody present.
//
// Pure, on the shape `matter-suggestion.ts` established: the caller gathers the evidence with
// firm-scoped reads, this decides, and the decision is testable with no database. Nothing here holds
// a database handle, an environment, or a clock.
//
// The interesting question is never "can we work out which matter" — the capture pipeline has had
// everything it needs for that since it shipped. It is what must be true before the platform is
// allowed to act on an answer it already has. So the guardrails, not the rule kinds, are the
// substance of this module, and they FAIL CLOSED by construction:
//
//   - the default arm is `stage`, never `file`;
//   - a precondition that cannot be evaluated produces a named reason, never an exception;
//   - a reason is an enum plus a sentence rendered from a phrasing table — never message content.
//
// The failure mode being defended against is the wrong-matter mass-file: a rule with a broad
// condition quietly filing hundreds of messages onto the wrong matter, discovered when privileged
// material reaches the wrong party. Every guardrail below aims at some part of that sentence.

import type { CapturedVia, DkimVerdict } from "./record.ts";

// The closed set of rule kinds. Adding a fourth is a schema change and a design change on purpose:
// the guardrails reason about what a rule MEANS in order to weigh it against competing evidence,
// which a pattern or a user-authored expression could never tell them.
export type AutoFileRuleKind = "threadContinuation" | "correspondentMatter";

export type AutoFileRuleState = "active" | "suspended" | "revoked";
export type AutoFilePromotion = "stage" | "file";

// Why a rule is taken out of service. Suspension is never deletion: a suspended rule with its
// history explains what had been filing, a deleted one leaves the firm unable to say.
export type AutoFileSuspendedReason =
  | "creatorAccessWithdrawn"
  | "matterClosed"
  | "blastBound"
  | "undoRate"
  | "member";

// Why nothing fired at all. A closed set, one entry per guardrail that refuses outright.
export type AutoFileSuppressionReason =
  | "ambiguousEvidence" // the deciding evidence names more than one matter
  | "creatorAccessWithdrawn" // the delegating member can no longer reach the matter
  | "senderNotAuthenticated" // a sender-identity rule with no authenticated sender to stand on
  | "signatureFailed" // the cryptography said no, on a capture that carried the original
  | "humanFilingDecision" // a person already filed this message, or removed it from here
  | "matterNotOpen" // the target is closed, prospective, or platform-owned
  | "ruleNotActive" // every rule that matched is suspended or revoked
  | "incompleteEvidence"; // a precondition could not be evaluated — the fail-closed arm

// Why a rule that DID fire landed staged rather than filed. Distinct from a suppression: the message
// still reaches the right matter, and a person still confirms it.
export type AutoFileDemotionReason =
  | "rulePosture" // the rule itself only ever wanted to stage
  | "firmPolicyDirectFilingOff" // the firm-level ceiling is down; no rule may file unattended
  | "conflictHold" // the filing-time conflict/wall hook holds the link at staged
  | "blastBound" // the rule is firing far more often than a person would
  | "undoRate"; // the rule's recent firings are being undone

// One candidate rule, as the caller resolved it from the fire-time lookup by match value.
export interface AutoFileCandidateRule {
  readonly ruleId: string;
  readonly kind: AutoFileRuleKind;
  readonly matterId: string;
  readonly matchValue: string;
  readonly promotion: AutoFilePromotion;
  readonly state: AutoFileRuleState;
  // Does the delegating member still hold access to this rule's matter? `null` means the question
  // could not be answered, which fails closed exactly as `false` does — but without claiming to know
  // that access was withdrawn, so it recommends no suspension.
  readonly creatorRetainsMatterAccess: boolean | null;
  // The rule's own recent activity, derived off the request path from the decision ledger.
  readonly firesInWindow: number;
  readonly undosInRecentFires: number;
}

// One link the message already carries. `automatic` distinguishes a machine's link from a person's,
// which is the difference between evidence and a decision.
export interface AutoFileExistingLink {
  readonly matterId: string;
  readonly state: "staged" | "filed" | "unlinked";
  readonly automatic: boolean;
}

// A matter the deciding evidence names, with the facts a firing needs about it.
export interface AutoFileTargetMatter {
  readonly matterId: string;
  readonly status: "prospective" | "open" | "closed";
  // A platform-owned row that exists to satisfy a structural requirement rather than to hold a
  // client engagement. Never a filing target for a rule.
  readonly systemOwned: boolean;
}

// Everything the guardrails need, gathered by the caller in bounded reads. Every field is required:
// an absent one is what `incompleteEvidence` exists for, and the function treats a malformed input
// as unevaluable rather than guessing.
export interface AutoFileEvidence {
  readonly matchedRules: readonly AutoFileCandidateRule[];
  // Matters the message's thread already holds at least one `filed` link on.
  readonly threadMatterIds: readonly string[];
  // Matters named by an exact matter-number match in the subject line.
  readonly subjectMatterIds: readonly string[];
  readonly existingLinks: readonly AutoFileExistingLink[];
  readonly dkimVerdict: DkimVerdict;
  readonly capturedVia: CapturedVia;
  readonly dkimVerifiedDomain: string | null;
  // Did the verifying signature cover the WHOLE canonical body? A DKIM signature carrying `l=` signs
  // only a prefix, so anyone holding one legitimately signed message from a domain can append
  // arbitrary content and the signature still verifies — and the appended part is precisely the part
  // an attacker wrote. The verdict stays an honest `pass` because the cryptography did pass; this is
  // the field that keeps a partially-covered pass from being enough to file unattended.
  readonly dkimBodyFullyCovered: boolean;
  readonly targetMatters: readonly AutoFileTargetMatter[];
  // The filing-time conflict/ethical-wall hook's answer for this message and matter.
  readonly conflictHold: boolean;
  // The firm-level ceiling. With it down every rule stages, whatever its own posture — no member can
  // opt the firm into unattended filing.
  readonly firmDirectFilingPermitted: boolean;
  // The firm's circuit-breaker thresholds, resolved by the caller. Stated rather than defaulted here
  // for the same reason every other field is: a gatherer that did not resolve them did not answer the
  // question, and the breaker is the guardrail whose absence is least visible.
  readonly circuitBreaker: AutoFileCircuitBreakerThresholds;
}

export interface AutoFileSuspensionRecommendation {
  readonly ruleId: string;
  readonly reason: AutoFileSuspendedReason;
}

export interface AutoFileDecision {
  // `noRule` means nothing links: either no rule looked at this message, or a guardrail refused.
  readonly outcome: "file" | "stage" | "noRule";
  readonly matterId: string | null;
  readonly ruleId: string | null;
  readonly suppressionReason: AutoFileSuppressionReason | null;
  readonly demotionReason: AutoFileDemotionReason | null;
  // The rule to take out of service, and why. Surfaced, never deleted.
  readonly suspension: AutoFileSuspensionRecommendation | null;
  // One sentence per fact, for the person asking why this message is where it is. Rendered from the
  // enums above; carries no subject, no address, and no display name.
  readonly reasons: readonly string[];
}

// The circuit breaker's thresholds. A firm sets these — a mailing list on a correspondent rule looks
// different at a two-person firm and at one whose client copies it on a daily distribution — but the
// breaker itself is not optional, which is what the bounds below are for.
export interface AutoFileCircuitBreakerThresholds {
  // A rule firing this often in a rolling hour is not a person's correspondence — it is a mailing
  // list, a bounce loop, or an autoresponder, and it shows up as a rate long before it shows up as a
  // hundred wrongly-filed messages.
  //
  // THE BOUND IS "THE WINDOW PLUS ONE QUEUE BATCH", NOT A HARD CEILING, and saying so is the honest
  // description. `firesInWindow` is derived from a bounded index walk BEFORE the decision and the
  // decision row is written after, so concurrent captures of one rule all read the same pre-increment
  // count: N messages arriving together at count 24 each decide `file` and the window ends at 24 + N.
  // A maintained counter would close that at the price of two contended hot-path writes on every
  // capture, which is a worse trade for a guardrail whose job is to catch a rule firing hundreds of
  // times — an overshoot of one batch does not change that answer.
  readonly maxFiresPerWindow: number;
  // How many recent firings the undo rate is measured over — the denominator of "three of the last
  // ten". It bounds the activity read's second walk, not the decision here.
  readonly recentFireWindow: number;
  // Undos are the honest feedback: the firm telling the platform the rule is wrong. Enough of them in
  // the recent-fire window and the rule stops filing and asks.
  readonly maxUndosInRecentFires: number;
}

// The platform defaults: what every firm that has never touched the setting gets, and what the
// breaker did before it was settable at all.
export const DEFAULT_AUTO_FILE_CIRCUIT_BREAKER: AutoFileCircuitBreakerThresholds = {
  maxFiresPerWindow: 25,
  recentFireWindow: 10,
  maxUndosInRecentFires: 3,
};

// A CIRCUIT BREAKER A FIRM CAN SWITCH OFF IS NOT A CIRCUIT BREAKER. Every threshold is a positive
// integer inside a finite range, so no setting a firm can write leaves the runaway-automation
// guardrail unreachable:
//
//   - `maxFiresPerWindow` has a ceiling because an arbitrarily large one is the off switch — and
//     because the activity read walks up to the threshold plus one row per candidate rule per
//     captured message, so an unbounded threshold is also an unbounded read on the capture path. A
//     rule firing five hundred times in an hour is runaway under any firm's reading.
//   - `maxUndosInRecentFires` may never exceed `recentFireWindow`: the undo count is capped by the
//     window it is measured over, so a threshold above it could never be reached — the breaker would
//     read as configured and never trip. That cross-field rule is enforced where the setting is
//     validated, and re-checked here.
//   - every floor is one rather than zero. A zero fire threshold would trip on a rule's first firing,
//     and a zero undo threshold trips on every firing whether or not anything was undone — both stop
//     unattended filing entirely, which is a setting nobody means to write.
export const AUTO_FILE_CIRCUIT_BREAKER_BOUNDS = {
  maxFiresPerWindow: { minimum: 1, maximum: 500 },
  recentFireWindow: { minimum: 1, maximum: 100 },
  maxUndosInRecentFires: { minimum: 1, maximum: 100 },
} as const;

function isWithinBounds(value: number, bounds: { minimum: number; maximum: number }): boolean {
  return Number.isInteger(value) && value >= bounds.minimum && value <= bounds.maximum;
}

// Thresholds in a shape the breaker can actually act on. Anything else is unevaluable, not
// permission — the same reading a malformed rule gets.
export function isWellFormedCircuitBreaker(thresholds: AutoFileCircuitBreakerThresholds): boolean {
  return (
    thresholds !== null &&
    typeof thresholds === "object" &&
    isWithinBounds(
      thresholds.maxFiresPerWindow,
      AUTO_FILE_CIRCUIT_BREAKER_BOUNDS.maxFiresPerWindow,
    ) &&
    isWithinBounds(
      thresholds.recentFireWindow,
      AUTO_FILE_CIRCUIT_BREAKER_BOUNDS.recentFireWindow,
    ) &&
    isWithinBounds(
      thresholds.maxUndosInRecentFires,
      AUTO_FILE_CIRCUIT_BREAKER_BOUNDS.maxUndosInRecentFires,
    ) &&
    thresholds.maxUndosInRecentFires <= thresholds.recentFireWindow
  );
}

// The limit a caller MUST pass when deriving `firesInWindow`. The activity read caps its walk at the
// limit it is given, so a limit at or below the breaker's threshold would report a count that can
// never reach it — silently disabling the breaker rather than failing. Strictly greater, so a rule
// sitting exactly at the threshold is still distinguishable from one past it. Derived here rather
// than left to each call site to get right, because a wrong one is invisible.
export function activityWindowLimitFor(thresholds: AutoFileCircuitBreakerThresholds): number {
  return thresholds.maxFiresPerWindow + 1;
}

// A capture that carries the message's own bytes, so a signature is answerable at all. Forwarding
// rewrites headers and breaks the original signature, which is why a sender-identity rule can never
// fire on the forward or catch-all path — the platform can tell who forwarded a message there, not
// who sent it.
function carriesIntactOriginal(capturedVia: CapturedVia): boolean {
  return capturedVia === "addin" || capturedVia === "sync";
}

// The domain half of a normalized address, lowercased. Null when the value is not an address shape —
// which is the ordinary case for a thread rule's match value, and the unevaluable case for a
// correspondent rule's.
function domainOf(address: string): string | null {
  const at = address.lastIndexOf("@");
  if (at <= 0 || at === address.length - 1) return null;
  return address.slice(at + 1).toLowerCase();
}

// One sentence per reason, written for the person reading "why is this here" rather than the
// developer reading the enum. A table rather than a switch so exhaustiveness is the type, and so
// every phrasing sits in one place when the wording is revised — the discipline matter-suggestion.ts
// already keeps. No entry may interpolate anything from the message.
const SUPPRESSION_PHRASING: Record<AutoFileSuppressionReason, string> = {
  ambiguousEvidence:
    "The precise evidence pointed at more than one matter, so nothing was filed automatically.",
  creatorAccessWithdrawn:
    "The member who set this rule up can no longer open the matter, so the rule was stopped.",
  senderNotAuthenticated:
    "The sender's signature could not be confirmed, and this rule files on who sent the message.",
  signatureFailed: "The message's signature did not verify, so no rule was allowed to act on it.",
  humanFilingDecision: "Somebody has already decided where this message goes.",
  matterNotOpen: "The matter this rule names is not open.",
  ruleNotActive: "The rule that matched is not in service.",
  incompleteEvidence: "Something needed to decide this was unavailable, so nothing was filed.",
};

const DEMOTION_PHRASING: Record<AutoFileDemotionReason, string> = {
  rulePosture: "This rule places the message on the matter and leaves the filing to a person.",
  firmPolicyDirectFilingOff:
    "Your firm has not enabled automatic filing, so the message was placed on the matter for someone to confirm.",
  conflictHold: "A conflict check held the filing for review.",
  blastBound: "This rule has been firing unusually often, so it stopped filing and is asking.",
  undoRate: "This rule's recent filings have been undone, so it stopped filing and is asking.",
};

const FIRED_PHRASING: Record<AutoFileRuleKind, string> = {
  threadContinuation: "This conversation is already filed to this matter.",
  correspondentMatter: "A rule files mail from this sender to this matter.",
};

// One recorded evaluation, as a reader hands it back from the ledger. The enums are the whole record —
// the ledger holds no message content by construction — so this is everything a rendering can work
// from, and it is deliberately the same three tables the live decision renders through.
export interface AutoFileDecisionRecord {
  readonly outcome: "filed" | "staged" | "suppressed";
  readonly suppressionReason: string | null;
  readonly demotionReason: string | null;
  // The kind of the rule that acted, where one did. Null for a suppression attributable to the
  // evidence rather than to any single rule.
  readonly ruleKind: string | null;
}

// "Why is this message here", answered weeks later from the ledger rather than by re-deriving it —
// which is the point of recording the decision at all, since by then the message has been superseded
// and the correspondent's party role has changed.
//
// AN ENUM THIS BUILD DOES NOT RECOGNIZE RENDERS NOTHING. A ledger row written by a build that knew a
// reason this one does not is a real possibility on a rolling deploy, and the failure modes are not
// symmetrical: omitting a sentence loses detail, while inventing one — or throwing, and losing the
// whole answer — misinforms the person who has to explain the filing. So an unknown value is skipped
// silently and the recognized reasons still render.
export function describeAutoFileDecisionRecord(record: AutoFileDecisionRecord): readonly string[] {
  return [
    phrasingFor(FIRED_PHRASING, record.ruleKind),
    phrasingFor(SUPPRESSION_PHRASING, record.suppressionReason),
    phrasingFor(DEMOTION_PHRASING, record.demotionReason),
  ].filter((sentence): sentence is string => sentence !== undefined);
}

// One phrasing, or nothing. The `typeof` check is not ceremony: the key arrives from a stored row, and
// indexing a plain object with a value like `constructor` yields something that is not a sentence.
function phrasingFor<Key extends string>(
  table: Readonly<Record<Key, string>>,
  key: string | null,
): string | undefined {
  if (key === null) return undefined;
  const phrasing = (table as Readonly<Record<string, string | undefined>>)[key];
  return typeof phrasing === "string" ? phrasing : undefined;
}

// The evidence the caller owes this function. Listed rather than inferred so that adding a field to
// the input without gathering it fails closed instead of silently defaulting to permission.
const REQUIRED_EVIDENCE_FIELDS: readonly (keyof AutoFileEvidence)[] = [
  "matchedRules",
  "threadMatterIds",
  "subjectMatterIds",
  "existingLinks",
  "dkimVerdict",
  "dkimVerifiedDomain",
  "dkimBodyFullyCovered",
  "capturedVia",
  "targetMatters",
  "conflictHold",
  "firmDirectFilingPermitted",
  "circuitBreaker",
];

// A field the caller declared as a list, confirmed to actually be one. Written as a helper rather
// than inline so the element type survives the check: a bare `Array.isArray` on a readonly array
// widens it to `any[]`, which would silently disable every type check downstream of it.
function asArray<T>(value: readonly T[]): readonly T[] | null {
  return Array.isArray(value) ? value : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// A candidate the caller handed over in a shape the guardrails can actually reason about. Anything
// else is unevaluable, not permission.
function isWellFormedRule(rule: AutoFileCandidateRule): boolean {
  return (
    isNonEmptyString(rule.ruleId) &&
    isNonEmptyString(rule.matterId) &&
    isNonEmptyString(rule.matchValue) &&
    (rule.kind === "threadContinuation" || rule.kind === "correspondentMatter") &&
    (rule.promotion === "stage" || rule.promotion === "file") &&
    (rule.state === "active" || rule.state === "suspended" || rule.state === "revoked") &&
    Number.isFinite(rule.firesInWindow) &&
    Number.isFinite(rule.undosInRecentFires)
  );
}

function nothingLinked(
  suppressionReason: AutoFileSuppressionReason,
  extra: {
    ruleId?: string;
    matterId?: string;
    suspension?: AutoFileSuspensionRecommendation | null;
  } = {},
): AutoFileDecision {
  return {
    outcome: "noRule",
    matterId: extra.matterId ?? null,
    ruleId: extra.ruleId ?? null,
    suppressionReason,
    demotionReason: null,
    suspension: extra.suspension ?? null,
    reasons: [SUPPRESSION_PHRASING[suppressionReason]],
  };
}

// The decision for a capture no rule looked at: nothing linked, nothing suppressed, and — because the
// suppression reason is null — nothing for a caller to record either. Exported because a gatherer that
// finds no matching rule short-circuits before assembling the rest of the evidence, and the value it
// returns instead must be the same one this function would have produced.
export const NO_AUTO_FILE_RULE_MATCHED: AutoFileDecision = {
  outcome: "noRule",
  matterId: null,
  ruleId: null,
  suppressionReason: null,
  demotionReason: null,
  suspension: null,
  reasons: [],
};

// Does the DKIM evidence let this rule kind act? The precondition is asymmetric on purpose, and only
// binds where the question is answerable.
//
// `correspondentMatter` is the only kind whose condition is a claim about who sent the message, and
// `From` is trivially spoofable — a rule that files on an unauthenticated `From` is a mechanism for a
// stranger to insert a document into a matter file. So it requires the message's own bytes, a `pass`,
// and a verified domain matching the rule address's domain.
//
// `threadContinuation` rests on a condition a stranger cannot cheaply forge into a useful outcome:
// continuing a thread means knowing a Message-ID the firm holds, and the payoff of succeeding is that
// the message lands where it claims to belong. So only an outright `fail`, on a capture that carried
// the original, suppresses it.
//
// `unverified` is "no answer", never "no": unsigned internal mail, a rotated selector, a resolver
// outage, and a `.msg` export with no signable octets all land there, and reading them as failures
// would suppress the ordinary case.
function dkimSuppression(
  rule: AutoFileCandidateRule,
  verdict: DkimVerdict,
  verifiedDomain: string | null,
  capturedVia: CapturedVia,
  bodyFullyCovered: boolean,
): AutoFileSuppressionReason | null {
  const intactOriginal = carriesIntactOriginal(capturedVia);
  if (rule.kind === "correspondentMatter") {
    if (!intactOriginal || verdict !== "pass") return "senderNotAuthenticated";
    // A PASS OVER PART OF THE BODY IS NOT AUTHENTICATION OF THE MESSAGE. With `l=` the signature
    // covers a prefix and the rest is unsigned, so a genuinely signed message can be replayed with
    // arbitrary content appended and still verify. That is exactly the shape this rule kind must not
    // file on — the appended part is the attacker's — so a partial pass is treated as no answer about
    // the sender rather than as one.
    if (!bodyFullyCovered) return "senderNotAuthenticated";
    const ruleDomain = domainOf(rule.matchValue);
    if (ruleDomain === null) return "incompleteEvidence";
    if (verifiedDomain === null || verifiedDomain.toLowerCase() !== ruleDomain) {
      return "senderNotAuthenticated";
    }
    return null;
  }
  if (intactOriginal && verdict === "fail") return "signatureFailed";
  return null;
}

// Never contradict a person. Three sub-cases, all resolving the same way — and the third is the one
// that matters most, because a machine putting back what somebody deliberately removed is the
// clearest possible way to be wrong.
function humanDecisionSuppression(
  links: readonly AutoFileExistingLink[],
  targetMatterId: string,
): boolean {
  for (const link of links) {
    if (link.matterId === targetMatterId) {
      // Already filed here — nothing to do. Or previously unlinked from here: somebody removed it,
      // and no rule may put it back.
      if (link.state === "filed" || link.state === "unlinked") return true;
      continue;
    }
    // Filed to a different matter BY A PERSON. A message can legitimately belong to several matters,
    // but "a person filed this to one matter and the machine also put it on another" is the shape of
    // the failure this whole module exists to prevent; the suggestion machinery proposes it instead.
    if (link.state === "filed" && !link.automatic) return true;
  }
  return false;
}

// The decision. `noRule` when nothing linked, `stage` when a rule placed the message on a matter for
// a person to confirm, `file` only when every precondition held and both the firm and the rule asked
// for it.
export function resolveAutoFileDecision(evidence: AutoFileEvidence): AutoFileDecision {
  if (evidence === null || typeof evidence !== "object") {
    return nothingLinked("incompleteEvidence");
  }
  // Every field must be STATED, including the ones whose legitimate value is null. A gatherer that
  // omitted a field did not answer the question, and an unanswered question is never permission —
  // which is the difference between "the message carried no verified domain" and "nobody looked".
  for (const field of REQUIRED_EVIDENCE_FIELDS) {
    if (!(field in evidence)) return nothingLinked("incompleteEvidence");
  }
  const matchedRules = asArray(evidence.matchedRules);
  if (matchedRules === null) return nothingLinked("incompleteEvidence");
  if (matchedRules.length === 0) return NO_AUTO_FILE_RULE_MATCHED;
  if (!matchedRules.every(isWellFormedRule)) return nothingLinked("incompleteEvidence");

  const activeRules = matchedRules.filter((rule) => rule.state === "active");
  if (activeRules.length === 0) {
    return nothingLinked("ruleNotActive", { ruleId: matchedRules[0]?.ruleId });
  }

  const threadMatterIds = asArray(evidence.threadMatterIds);
  const subjectMatterIds = asArray(evidence.subjectMatterIds);
  const existingLinks = asArray(evidence.existingLinks);
  const targetMatters = asArray(evidence.targetMatters);
  if (
    threadMatterIds === null ||
    subjectMatterIds === null ||
    existingLinks === null ||
    targetMatters === null ||
    typeof evidence.conflictHold !== "boolean" ||
    typeof evidence.dkimBodyFullyCovered !== "boolean" ||
    typeof evidence.firmDirectFilingPermitted !== "boolean" ||
    !isWellFormedCircuitBreaker(evidence.circuitBreaker) ||
    !isNonEmptyString(evidence.capturedVia) ||
    !isNonEmptyString(evidence.dkimVerdict)
  ) {
    return nothingLinked("incompleteEvidence", { ruleId: activeRules[0]?.ruleId });
  }

  // ── Guardrail 1: never fire on ambiguity.
  //
  // Structural, not score-based. The evidence partitions into DECIDING (matched rules, thread
  // continuation, exact subject matter number — each naming a matter on a precise, checkable ground)
  // and NON-DECIDING (a correspondent being a party, which accumulates by design, and a typed search
  // term, which does not exist off the request path at all). If the deciding set names more than one
  // distinct matter — two rules disagreeing, a rule pointing one way and the subject line another, a
  // thread that resolves to two matters — nothing fires and the capture lands as it does today, with
  // the candidates offered as suggestions to somebody equipped to resolve them.
  //
  // Computed here rather than read off the suggestion ranking's `ambiguous` flag on purpose: that
  // flag is a tie on a SCORE, and the score is a sum of tuning constants for ordering a list a human
  // reads. Coupling an unattended filing to those constants would mean a future adjustment to how
  // suggestions are ordered silently changes which messages file themselves.
  const decidingMatterIds = new Set<string>();
  for (const rule of activeRules) decidingMatterIds.add(rule.matterId);
  // A MALFORMED ENTRY IS UNEVALUABLE, NOT ABSENT. Skipping it would shrink the deciding set, and a
  // deciding set of one is what permits a firing — so a thread that genuinely resolves to two matters,
  // one of them arriving malformed, would fire on the survivor. That is precisely the case guardrail 1
  // exists to refuse, and it is the same reading a malformed RULE already gets above.
  for (const matterId of [...threadMatterIds, ...subjectMatterIds]) {
    if (!isNonEmptyString(matterId)) {
      return nothingLinked("incompleteEvidence", { ruleId: activeRules[0]?.ruleId });
    }
    decidingMatterIds.add(matterId);
  }
  if (decidingMatterIds.size > 1) {
    return nothingLinked("ambiguousEvidence", { ruleId: activeRules[0]?.ruleId });
  }

  const [targetMatterId] = [...decidingMatterIds];
  if (targetMatterId === undefined) return nothingLinked("incompleteEvidence");

  // Among the rules naming the one target, the one that asked for the most is the one that fires;
  // rule id breaks the tie, so the same evidence always produces the same decision.
  const firingRule = [...activeRules]
    .filter((rule) => rule.matterId === targetMatterId)
    .sort((left, right) =>
      left.promotion === right.promotion
        ? left.ruleId.localeCompare(right.ruleId)
        : left.promotion === "file"
          ? -1
          : 1,
    )[0];
  if (firingRule === undefined) return nothingLinked("incompleteEvidence");

  // ── Guardrail 2: never file past a conflict or wall hold.
  //
  // Not new mechanism — the same filing-time hook a person's accept traverses, whose answer to any
  // doubt is to demote to staged. When the conflicts engine drops in behind it, automatic and manual
  // filing are protected identically with no second integration. Recorded now, weighed below with
  // the other reasons a firing may land staged.
  const conflictHold = evidence.conflictHold;

  // ── Guardrail 3: never across a wall, and never on withdrawn access.
  //
  // A rule may name only a matter its creator could reach when they made it — that is what makes it a
  // delegation rather than an escalation — AND the creator must still hold that access now, because
  // access is withdrawn as well as granted and a durable rule must not outlive its authorization.
  // Losing access suspends the rule and surfaces it; it never deletes it.
  if (firingRule.creatorRetainsMatterAccess === false) {
    return nothingLinked("creatorAccessWithdrawn", {
      ruleId: firingRule.ruleId,
      matterId: targetMatterId,
      suspension: { ruleId: firingRule.ruleId, reason: "creatorAccessWithdrawn" },
    });
  }
  if (firingRule.creatorRetainsMatterAccess !== true) {
    // Unanswerable is not "yes". It is also not proof the access was withdrawn, so it recommends no
    // suspension — the rule is simply not permitted to act on this capture.
    return nothingLinked("incompleteEvidence", {
      ruleId: firingRule.ruleId,
      matterId: targetMatterId,
    });
  }

  // ── Guardrail 4: the signature gates the robot, not the record.
  const dkimReason = dkimSuppression(
    firingRule,
    evidence.dkimVerdict,
    evidence.dkimVerifiedDomain,
    evidence.capturedVia,
    evidence.dkimBodyFullyCovered,
  );
  if (dkimReason !== null) {
    return nothingLinked(dkimReason, {
      ruleId: firingRule.ruleId,
      matterId: targetMatterId,
    });
  }

  // ── Guardrail 5: never over a human decision.
  if (humanDecisionSuppression(existingLinks, targetMatterId)) {
    return nothingLinked("humanFilingDecision", {
      ruleId: firingRule.ruleId,
      matterId: targetMatterId,
    });
  }

  // ── Guardrail 6: never into a matter that is not open.
  //
  // Cheap, and it catches the common stale-rule case — a matter concluded and nobody pruned the
  // rules — which is what makes the suspension list a natural review surface at matter close.
  const target = targetMatters.find((matter) => matter.matterId === targetMatterId);
  if (target === undefined) {
    return nothingLinked("incompleteEvidence", {
      ruleId: firingRule.ruleId,
      matterId: targetMatterId,
    });
  }
  if (target.systemOwned || target.status !== "open") {
    return nothingLinked("matterNotOpen", {
      ruleId: firingRule.ruleId,
      matterId: targetMatterId,
      // A platform-owned row was never a legitimate target, so that case is a refusal rather than a
      // rule that has gone stale; only a matter that CLOSED asks for the rule to be pruned.
      suspension: target.systemOwned ? null : { ruleId: firingRule.ruleId, reason: "matterClosed" },
    });
  }

  // ── Guardrail 7: the blast bound.
  //
  // The rule stops filing on its own and a person is asked — a property of the rule, not an
  // operations alert. It reverts to staging rather than refusing outright: the message still belongs
  // on the matter, it is the unattended FILING that has stopped being trustworthy.
  //
  // The thresholds are the firm's, within bounds that keep the breaker reachable whatever a firm
  // writes; a firm that has never set them gets DEFAULT_AUTO_FILE_CIRCUIT_BREAKER.
  const breaker = evidence.circuitBreaker;
  let suspension: AutoFileSuspensionRecommendation | null = null;
  let breakerDemotion: AutoFileDemotionReason | null = null;
  if (firingRule.firesInWindow >= breaker.maxFiresPerWindow) {
    breakerDemotion = "blastBound";
    suspension = { ruleId: firingRule.ruleId, reason: "blastBound" };
  } else if (firingRule.undosInRecentFires >= breaker.maxUndosInRecentFires) {
    breakerDemotion = "undoRate";
    suspension = { ruleId: firingRule.ruleId, reason: "undoRate" };
  }

  // ── Promotion. Two explicit acts by two kinds of principal are required before a message files
  // itself: an administrator raising the firm ceiling, and a member choosing it for this rule.
  //
  // Reported strongest-first, and a rule that never asked to file is reported as exactly that rather
  // than as something having stopped it — the reader wants the true answer to "why is this staged",
  // not the first check that happened to be consulted.
  const demotionReason: AutoFileDemotionReason | null =
    firingRule.promotion !== "file"
      ? "rulePosture"
      : !evidence.firmDirectFilingPermitted
        ? "firmPolicyDirectFilingOff"
        : breakerDemotion !== null
          ? breakerDemotion
          : conflictHold
            ? "conflictHold"
            : null;
  const reasons = [FIRED_PHRASING[firingRule.kind]];
  if (demotionReason !== null) reasons.push(DEMOTION_PHRASING[demotionReason]);
  // A CONFLICT HOLD IS ALWAYS STATED, even when it did not win the ladder. `demotionReason` is the
  // single machine-readable answer to "what stopped this filing" and stays strongest-first; but a
  // message held by the conflict hook on a rule that only ever wanted to stage would otherwise be
  // explained as a posture choice and never mention the conflict at all. The explanation is the whole
  // product of this function, and "a conflict check held this" is not a detail a reader may lose.
  if (conflictHold && demotionReason !== "conflictHold") {
    reasons.push(DEMOTION_PHRASING.conflictHold);
  }

  return {
    outcome: demotionReason === null ? "file" : "stage",
    matterId: targetMatterId,
    ruleId: firingRule.ruleId,
    suppressionReason: null,
    demotionReason,
    suspension,
    reasons,
  };
}
