import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { commitEffectBatch, guarded } from "@magna-carta/data-access/effect-batch";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import {
  createEmailAutoFileRule,
  findAutoFileRuleByMatch,
  readAutoFileDecisionsForMessage,
  readAutoFileRuleById,
  readAutoFileRulesByIds,
  readAutoFileRulesForMatter,
  readAutoFileRuleMatterIds,
  readAutomaticRuleTallies,
  resumeEmailAutoFileRule,
  revokeEmailAutoFileRule,
  suspendEmailAutoFileRule,
  updateEmailAutoFileRulePromotion,
  type EmailAutoFileRuleRow,
} from "@magna-carta/data-access/email-auto-file-statements";
import {
  filedMatterIdsForMessage,
  readFiledMattersForThreads,
  readMessageById,
} from "@magna-carta/data-access/email-filing-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { describeAutoFileDecisionRecord } from "@magna-carta/email-filing/auto-file-rules";
import { normalizeAddress } from "@magna-carta/email-filing/record";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { EmailAutoFileRuleId, MatterId } from "@magna-carta/identifiers/types";
import { readMatterFilingTargets } from "@magna-carta/matters/queries";
import type { Bindings } from "../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables, FirmContext } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import {
  idempotencyKeyHeader,
  identifierField,
  identifierPathParam,
} from "../../contracts/common.ts";
import { capped } from "../../contracts/pagination.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { readAutoFileDirectFilingPermitted } from "../../emails/auto-file-policy.ts";
import { filterAccessibleMatters } from "../../emails/matter-access.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// The management surface for automatic email filing: how a rule comes to exist, how a firm sees what
// its rules have been doing, and how it stops one that is getting it wrong.
//
// Everything that DECIDES already shipped — the pure guardrail function, the port on the capture core,
// the evidence gatherer on the queue consumer. What was missing was the other half of a delegation:
// something that delegates. Without these routes the engine evaluated an empty candidate set on every
// capture, which is a mechanism a firm can neither use nor audit nor switch off.
//
// Three properties hold across every route here and are each tested by removal:
//
//   1. NOTHING RETRO-FILES. Creating, promoting, or resuming a rule reads existing mail and writes
//      none of it. A rule applies to what arrives afterwards, which is a different consent shape from
//      sweeping the archive and is why creation returns a rule rather than a count of messages moved.
//   2. A RULE NEVER OUT-REACHES ITS CREATOR. Every write confirms the caller can open the matter now,
//      through the same single narrowing point every other matter set in this subsystem passes; the
//      capture path then re-asks the same question of the delegating member at every fire.
//   3. THE FIRM CEILING IS REFUSED AT, NOT AROUND. A rule may not be stored asking to file while the
//      firm has not permitted unattended filing. Storing it and quietly staging would tell the member
//      who set it that their firm had opted in.

const matterParam = z.object({ matterId: identifierPathParam("matter", "matterId") });
const ruleParam = z.object({
  matterId: identifierPathParam("matter", "matterId"),
  emailAutoFileRuleId: identifierPathParam("emailAutoFileRule", "emailAutoFileRuleId"),
});

const RuleKind = z.enum(["threadContinuation", "correspondentMatter"]);
const RulePromotion = z.enum(["stage", "file"]);
const RuleState = z.enum(["active", "suspended", "revoked"]);
const RuleSuspendedReason = z.enum([
  "creatorAccessWithdrawn",
  "matterClosed",
  "blastBound",
  "undoRate",
  "member",
]);

const AutoFileRule = z
  .object({
    emailAutoFileRuleId: z.string(),
    kind: RuleKind,
    matterId: z.string(),
    // The normalized sender address a correspondent rule matches, or the conversation a thread rule
    // follows. Readable here and deliberately absent from the audit metadata: this read is already
    // narrowed to a matter the caller can open, where the sender is on the correspondence anyway.
    matchValue: z.string(),
    // What the rule ASKS for.
    promotion: RulePromotion,
    // What it would actually do today. A rule asking to file under a firm that has not permitted
    // unattended filing still stages, and a reader who is shown only `promotion` would believe
    // otherwise.
    effectivePromotion: RulePromotion,
    state: RuleState,
    suspendedReason: RuleSuspendedReason.nullable(),
    createdBy: z.string().nullable(),
    // The manual filing that occasioned the rule, where there was one — the authorizing act an audit
    // of "why did this file itself" terminates in.
    createdFromEmailMessageId: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("AutoFileRule");

const AutoFileRuleList = z.object({ data: z.array(AutoFileRule) }).openapi("AutoFileRuleList");

const CreateAutoFileRuleRequest = z
  .object({
    kind: RuleKind,
    // The message whose manual filing occasioned this rule. REQUIRED for a thread rule, because a
    // conversation is not something a member types — and because deriving the thread from a message
    // the firm already filed is what proves the rule's condition is already true.
    createdFromEmailMessageId: identifierField("emailMessage").optional(),
    // A correspondent rule's sender, when it is not being taken from the filing above.
    correspondentAddress: z.email().max(320).optional(),
    promotion: RulePromotion.optional(),
  })
  .openapi("CreateAutoFileRuleRequest");

const UpdateAutoFileRuleRequest = z
  .object({ promotion: RulePromotion })
  .openapi("UpdateAutoFileRuleRequest");

const AutoFileDecisionEntry = z
  .object({
    emailAutoFileDecisionId: z.string(),
    emailAutoFileRuleId: z.string().nullable(),
    matterId: z.string().nullable(),
    outcome: z.enum(["filed", "staged", "suppressed"]),
    suppressionReason: z.string().nullable(),
    demotionReason: z.string().nullable(),
    // The plain sentences, rendered from the stored enums at read time. Never message content: the
    // ledger holds none, so there is none here to leak.
    reasons: z.array(z.string()),
    createdAt: z.string(),
  })
  .openapi("AutoFileDecisionEntry");

const AutoFileDecisionList = capped(AutoFileDecisionEntry).openapi("AutoFileDecisionList");

const AutoFileReviewEntry = z
  .object({
    emailAutoFileRuleId: z.string(),
    kind: RuleKind,
    matterId: z.string(),
    promotion: RulePromotion,
    state: RuleState,
    suspendedReason: RuleSuspendedReason.nullable(),
    // What this rule did inside the window, counted in the database over every link it made on a
    // matter the caller can see — exact, not sampled. `undoneCount` is the feedback signal: a link
    // the rule made that somebody has since taken off.
    filedCount: z.number().int(),
    stagedCount: z.number().int(),
    undoneCount: z.number().int(),
    lastActedAt: z.string(),
  })
  .openapi("AutoFileReviewEntry");

const AutoFileReview = z
  .object({
    windowStart: z.string(),
    // True when the firm holds rules on more matters than one answer considers. The per-rule counts
    // below are exact for the rules that DID appear; this says some rules may be missing from the
    // list entirely. It is not a page marker — see the ceiling's comment below.
    matterScopeCapped: z.boolean(),
    data: z.array(AutoFileReviewEntry),
  })
  .openapi("AutoFileReview");

const MANAGE = "emails:manageAutoFileRules" as const;
const READ = "emails:read" as const;

// How far back the review read looks, and how many MATTERS it will consider. Both are fixed rather
// than caller-supplied, and the second is why: the read narrows its matter set through the wall filter
// and then counts only what survived, which is only sound over an UNPAGED window. A cursor over a set
// a wall can shrink hands out short pages and calls it the end of the list.
//
// The ceiling is on the matters the firm has set RULES on, not on links. Links grow with every message
// a rule files and a cap there made every count understate; matters carrying a rule is the firm's own
// configuration, and when the ceiling is reached the answer says so rather than quietly narrowing.
const REVIEW_WINDOW_DAYS = 30;
const REVIEW_MATTER_LIMIT = 500;
// A matter cannot hold an unbounded number of rules in practice — one per correspondent, one per
// live conversation — but the read still carries a ceiling rather than trusting that.
const MATTER_RULE_LIMIT = 200;
const MESSAGE_DECISION_LIMIT = 50;

const createMeta: RouteMeta = {
  operationId: "emails.createAutoFileRule",
  surface: "app",
  authenticated: true,
  permission: MANAGE,
  resource: "matter",
  audited: true,
  // Required, unlike the transitions below: a rule is a durable delegation, and a double-submitted
  // create must hand back the first rule rather than race the unique index into a 409 the caller
  // cannot distinguish from somebody else's rule.
  idempotency: "required",
  rateLimit: "default",
};

const listMeta: RouteMeta = {
  operationId: "emails.listAutoFileRules",
  surface: "app",
  authenticated: true,
  permission: READ,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

// The three transitions and the promotion edit are each guarded on the rule's current state, so a
// repeat is refused on its own terms rather than needing a key to be safe.
const updateMeta: RouteMeta = {
  operationId: "emails.updateAutoFileRule",
  surface: "app",
  authenticated: true,
  permission: MANAGE,
  resource: "matter",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

const suspendMeta: RouteMeta = {
  operationId: "emails.suspendAutoFileRule",
  surface: "app",
  authenticated: true,
  permission: MANAGE,
  resource: "matter",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

const resumeMeta: RouteMeta = {
  operationId: "emails.resumeAutoFileRule",
  surface: "app",
  authenticated: true,
  permission: MANAGE,
  resource: "matter",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

const revokeMeta: RouteMeta = {
  operationId: "emails.revokeAutoFileRule",
  surface: "app",
  authenticated: true,
  permission: MANAGE,
  resource: "matter",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

const decisionsMeta: RouteMeta = {
  operationId: "emails.autoFileDecisions",
  surface: "app",
  authenticated: true,
  permission: READ,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const reviewMeta: RouteMeta = {
  operationId: "emails.autoFileReview",
  surface: "app",
  authenticated: true,
  permission: READ,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const unauthenticated = {
  description: "No valid session",
  content: { "application/problem+json": { schema: Problem } },
} as const;
const forbiddenManage = {
  description: "The session member lacks emails:manageAutoFileRules",
  content: { "application/problem+json": { schema: Problem } },
} as const;
const forbiddenRead = {
  description: "The session member lacks emails:read",
  content: { "application/problem+json": { schema: Problem } },
} as const;
const rateLimited = {
  description: "Rate limit exceeded",
  content: { "application/problem+json": { schema: Problem } },
} as const;
const matterAbsent = {
  description: "No such matter, or one the caller cannot access",
  content: { "application/problem+json": { schema: Problem } },
} as const;
const ruleAbsent = {
  description: "No such rule on this matter, or a matter the caller cannot access",
  content: { "application/problem+json": { schema: Problem } },
} as const;

const createRoute = defineOpenAPIRoute(createMeta, {
  method: "post",
  path: "/api/v1/matters/{matterId}/auto-file-rules",
  description:
    "Create an auto-file rule on this matter: a typed, revocable instruction to put a narrow class " +
    "of future messages on it without waiting for somebody to choose. A thread rule follows the " +
    "conversation of a message already filed here and must name that message; a correspondent rule " +
    "matches one sender's address exactly, taken either from a filed message or given directly. " +
    "Creating a rule never touches mail the firm already holds — it applies only to what arrives " +
    "afterwards. A rule may ask to file outright rather than stage, but only where an administrator " +
    "has already permitted unattended filing for the firm; asking for it while that is off is " +
    "refused rather than stored.",
  request: {
    params: matterParam,
    headers: idempotencyKeyHeader,
    body: {
      content: { "application/json": { schema: CreateAutoFileRuleRequest } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "The rule was created",
      content: { "application/json": { schema: AutoFileRule } },
    },
    400: {
      description: "The Idempotency-Key header is missing",
      content: { "application/problem+json": { schema: Problem } },
    },
    401: unauthenticated,
    403: forbiddenManage,
    404: matterAbsent,
    409: {
      description:
        "A request with this Idempotency-Key is in progress, or this exact rule already exists",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description:
        "The rule could not be created as asked, or the Idempotency-Key was reused with a different body",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: rateLimited,
  },
});

const listRoute = defineOpenAPIRoute(listMeta, {
  method: "get",
  path: "/api/v1/matters/{matterId}/auto-file-rules",
  description:
    "The auto-file rules on this matter, newest first, with what each one asks for and what it " +
    "would actually do under the firm's current posture. Revoked rules are omitted; a suspended one " +
    "is listed with the reason it stopped, because a suspended rule with its history explains what " +
    "had been filing and a hidden one does not.",
  request: { params: matterParam },
  responses: {
    200: {
      description: "The matter's rules",
      content: { "application/json": { schema: AutoFileRuleList } },
    },
    401: unauthenticated,
    403: forbiddenRead,
    404: matterAbsent,
    429: rateLimited,
  },
});

const updateRoute = defineOpenAPIRoute(updateMeta, {
  method: "patch",
  path: "/api/v1/matters/{matterId}/auto-file-rules/{emailAutoFileRuleId}",
  description:
    "Change whether this rule files the message outright or places it on the matter for somebody to " +
    "confirm. Asking it to file while the firm has not permitted unattended filing is refused, so a " +
    "stored posture always means what it says. Only an active rule can be re-postured: a suspended " +
    "or revoked rule is not quietly re-armed by a promotion edit.",
  request: {
    params: ruleParam,
    headers: idempotencyKeyHeader,
    body: {
      content: { "application/json": { schema: UpdateAutoFileRuleRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The updated rule",
      content: { "application/json": { schema: AutoFileRule } },
    },
    401: unauthenticated,
    403: forbiddenManage,
    404: ruleAbsent,
    409: {
      description: "The rule is not active, or a request with this Idempotency-Key is in progress",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description:
        "The firm has not permitted unattended filing, or the Idempotency-Key was reused with a different body",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: rateLimited,
  },
});

const suspendRoute = defineOpenAPIRoute(suspendMeta, {
  method: "post",
  path: "/api/v1/matters/{matterId}/auto-file-rules/{emailAutoFileRuleId}/suspend",
  description:
    "Take this rule out of service. It stops acting immediately and stays in the matter's list with " +
    "the reason it stopped. Suspending is never deleting: messages the rule already placed are left " +
    "exactly where they are, and the record of what it had been doing survives.",
  request: { params: ruleParam, headers: idempotencyKeyHeader },
  responses: {
    200: {
      description: "The suspended rule",
      content: { "application/json": { schema: AutoFileRule } },
    },
    401: unauthenticated,
    403: forbiddenManage,
    404: ruleAbsent,
    409: {
      description: "The rule is not active, so there is nothing to suspend",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: rateLimited,
  },
});

const resumeRoute = defineOpenAPIRoute(resumeMeta, {
  method: "post",
  path: "/api/v1/matters/{matterId}/auto-file-rules/{emailAutoFileRuleId}/resume",
  description:
    "Put a suspended rule back in service. It resumes with the posture it had, and it applies only " +
    "to mail that arrives afterwards — resuming a rule never reaches back over the messages that " +
    "arrived while it was stopped. A revoked rule is never resurrected this way.",
  request: { params: ruleParam, headers: idempotencyKeyHeader },
  responses: {
    200: {
      description: "The resumed rule",
      content: { "application/json": { schema: AutoFileRule } },
    },
    401: unauthenticated,
    403: forbiddenManage,
    404: ruleAbsent,
    409: {
      description: "The rule is not suspended, so there is nothing to resume",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: rateLimited,
  },
});

const revokeRoute = defineOpenAPIRoute(
  {
    ...revokeMeta,
    reversal: {
      kind: "none",
      reason:
        "A revoked rule is kept so every message it placed can still name it, and it cannot be resumed. The way back is a new rule.",
    },
  },
  {
    method: "delete",
    path: "/api/v1/matters/{matterId}/auto-file-rules/{emailAutoFileRuleId}",
    description:
      "Retire this rule for good. Still not a delete: the rule row survives so that every message it " +
      "placed can still say which rule placed it, and the messages themselves are untouched. A revoked " +
      "rule cannot be resumed — create a new one instead.",
    request: { params: ruleParam, headers: idempotencyKeyHeader },
    responses: {
      200: {
        description: "The revoked rule",
        content: { "application/json": { schema: AutoFileRule } },
      },
      401: unauthenticated,
      403: forbiddenManage,
      404: ruleAbsent,
      409: {
        description: "The rule is already revoked",
        content: { "application/problem+json": { schema: Problem } },
      },
      429: rateLimited,
    },
  },
);

const decisionsRoute = defineOpenAPIRoute(decisionsMeta, {
  method: "get",
  path: "/api/v1/emails/{emailMessageId}/auto-file-decisions",
  description:
    "Why this message is where it is: every automatic-filing decision recorded about it, newest " +
    "first, each with the rule responsible and the reasons in plain language. Decisions about a " +
    "matter the caller cannot access are absent entirely — no row and no count. A message no rule " +
    "ever looked at has no decisions, which is a different answer from a rule having been stopped. " +
    "`capped` is true when the message recorded more decisions than the answer names; it is about " +
    "the read's own ceiling and never about the access filter, which removes rows silently by " +
    "design.",
  request: {
    params: z.object({ emailMessageId: identifierPathParam("emailMessage", "emailMessageId") }),
  },
  responses: {
    200: {
      description: "The message's automatic-filing decisions",
      content: { "application/json": { schema: AutoFileDecisionList } },
    },
    401: unauthenticated,
    403: forbiddenRead,
    404: {
      description: "Unknown message, or one the caller cannot access",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: rateLimited,
  },
});

const reviewRoute = defineOpenAPIRoute(reviewMeta, {
  method: "get",
  path: "/api/v1/emails/auto-file-review",
  description:
    "What the firm's auto-file rules have actually been doing over the last thirty days: per rule, " +
    "how many messages it filed, how many it placed for confirmation, how many of those somebody " +
    "has since removed, and whether it has stopped itself. Every count is exact over the window — " +
    "this is the read a firm looks at before deciding whether to permit filing without " +
    "confirmation, and a count that understated would make a rule look less consequential than it " +
    "is. Rules on matters the caller cannot access contribute nothing: no entry and no count. " +
    "`matterScopeCapped` is true in the rare case that the firm holds rules on more matters than " +
    "one answer considers, which means a rule may be missing from the list rather than mis-counted.",
  responses: {
    200: {
      description: "Recent automatic filing activity, per rule",
      content: { "application/json": { schema: AutoFileReview } },
    },
    401: unauthenticated,
    403: forbiddenRead,
    429: rateLimited,
  },
});

type AutoFileContext = Context<{ Bindings: Bindings; Variables: AppVariables }>;

// Existence and access are answered together and reported the same way, for the reason the filing
// route already documents: reporting them separately turns any matter-rooted endpoint into an oracle
// for a walled matter's existence.
async function accessibleMatter(
  firm: FirmContext,
  userId: string,
  matterId: MatterId,
): Promise<{ status: string; systemOwned: boolean } | null> {
  const [target] = await readMatterFilingTargets(firm.firmDatabase, [matterId]);
  if (target === undefined) return null;
  const visible = await filterAccessibleMatters(firm, userId, [matterId]);
  return visible.length > 0 ? { status: target.status, systemOwned: target.systemOwned } : null;
}

function matterNotFound(c: AutoFileContext): ProblemResponse<404> {
  return problemJson(c, {
    type: "not-found",
    title: "Matter not found",
    status: 404,
    detail: "No such matter, or you cannot access it.",
  });
}

function ruleNotFound(c: AutoFileContext): ProblemResponse<404> {
  return problemJson(c, {
    type: "not-found",
    title: "Rule not found",
    status: 404,
    detail: "No such auto-file rule on this matter.",
  });
}

function notCreatable(c: AutoFileContext, detail: string): ProblemResponse<422> {
  return problemJson(c, {
    type: "auto-file-rule-not-creatable",
    title: "This rule cannot be created",
    status: 422,
    detail,
  });
}

function directFilingRefused(c: AutoFileContext): ProblemResponse<422> {
  return problemJson(c, {
    type: "auto-file-direct-filing-not-permitted",
    title: "Your firm has not enabled filing without confirmation",
    status: 422,
    detail:
      "A rule may only be set to file a message outright once an administrator has permitted " +
      "unattended filing for the whole firm. Until then a rule places the message on the matter " +
      "for somebody to confirm.",
  });
}

function notActionable(c: AutoFileContext, detail: string): ProblemResponse<409> {
  return problemJson(c, {
    type: "auto-file-rule-not-actionable",
    title: "The rule is not in a state that allows this",
    status: 409,
    detail,
  });
}

// The response shape, built once so every route answers with the same rule. `effectivePromotion` is
// resolved against the firm ceiling here rather than stored, because the ceiling moves and a stored
// copy would be stale the moment an administrator changed it.
function presentRule(
  rule: EmailAutoFileRuleRow,
  directFilingPermitted: boolean,
): z.infer<typeof AutoFileRule> {
  return {
    emailAutoFileRuleId: rule.id,
    kind: rule.kind,
    matterId: rule.matterId,
    matchValue: rule.matchValue,
    promotion: rule.promotion,
    effectivePromotion: rule.promotion === "file" && directFilingPermitted ? "file" : "stage",
    state: rule.state,
    suspendedReason: rule.suspendedReason,
    createdBy: rule.createdBy,
    createdFromEmailMessageId: rule.createdFromEmailMessageId,
    createdAt: rule.createdAt,
  };
}

// Resolve the rule a transition names, refusing absence and a matter the caller cannot open the same
// way. The matter in the path must be the rule's own matter: a rule addressed through a different
// matter's path would let a caller with access to one matter act on another's rule.
async function resolveRuleForMutation(
  c: AutoFileContext,
  matterId: MatterId,
  emailAutoFileRuleId: EmailAutoFileRuleId,
): Promise<{ rule: EmailAutoFileRuleRow } | { refusal: ProblemResponse<404> }> {
  const firm = requireChokepointFirmContext(c);
  const userId = requireChokepointUserId(c);
  if ((await accessibleMatter(firm, userId, matterId)) === null) {
    return { refusal: matterNotFound(c) };
  }
  const rule = await readAutoFileRuleById(firm.firmDatabase, emailAutoFileRuleId);
  // The matter in the path must be the rule's own. Answering on a rule reached through a different
  // matter's path would let access to one matter act on another's delegation.
  if (rule === null || rule.matterId !== matterId) return { refusal: ruleNotFound(c) };
  return { rule };
}

export function registerAutoFileRuleRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // POST /matters/{matterId}/auto-file-rules — the gesture the whole design is built around: a member
  // who just filed something by hand says "keep doing that". The rule inherits an authorizing act the
  // guardrails can point at, which is what makes an audit of "why did this file itself" terminate in a
  // person's decision rather than in a configuration screen.
  app.openapi(
    { ...createRoute, middleware: chokepointMiddleware(chokepoint, createRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { matterId } = c.req.valid("param");
      const body = c.req.valid("json");
      const promotion = body.promotion ?? "stage";

      const matter = await accessibleMatter(firm, userId, matterId);
      if (matter === null) return matterNotFound(c);
      // A rule the guardrails could never act on is refused rather than stored: the fire-time checks
      // would suppress on a closed or platform-owned matter forever, and a rule that never fires and
      // never says why is worse than no rule.
      if (matter.systemOwned || (matter.status !== "open" && matter.status !== "hold")) {
        return notCreatable(
          c,
          "An auto-file rule can only be created on an open matter. A rule naming a matter that is " +
            "not open would never act.",
        );
      }

      const directFilingPermitted = await readAutoFileDirectFilingPermitted(firm.firmDatabase);
      if (promotion === "file" && !directFilingPermitted) return directFilingRefused(c);

      // The filing the rule is learned from. Read once and reused for both kinds: it supplies the
      // thread for one and, where the caller did not give an address, the sender for the other.
      const source =
        body.createdFromEmailMessageId === undefined
          ? null
          : await readMessageById(firm.firmDatabase, body.createdFromEmailMessageId);
      if (body.createdFromEmailMessageId !== undefined && source === null) {
        return notCreatable(
          c,
          "No such message, so there is no filing for this rule to learn from.",
        );
      }

      let matchValue: string;
      if (body.kind === "threadContinuation") {
        if (source === null) {
          return notCreatable(
            c,
            "A rule that follows a conversation must name the message you filed, so the platform " +
              "knows which conversation you mean.",
          );
        }
        // The condition has to be ALREADY TRUE. A thread rule's whole claim is "your firm already
        // decided this conversation belongs here"; without a filed link on this matter that claim is
        // false, and the rule would be a guess wearing the strongest signal's clothes.
        const filedMatters = await readFiledMattersForThreads(firm.firmDatabase, [source.threadId]);
        if (!filedMatters.some((hit) => hit.matterId === matterId)) {
          return notCreatable(
            c,
            "This conversation has not been filed to this matter yet. File a message from it first, " +
              "then the rule can follow the decision you made.",
          );
        }
        matchValue = source.threadId;
      } else {
        const address = body.correspondentAddress ?? source?.fromAddress ?? null;
        if (address === null) {
          return notCreatable(
            c,
            "A rule that files one sender's mail needs that sender's address, either given directly " +
              "or taken from a message that carries one.",
          );
        }
        // The SAME normalization the capture path applies before it looks a rule up. A rule stored in
        // any other form is a rule that can never match.
        matchValue = normalizeAddress(address);
      }

      const existing = await findAutoFileRuleByMatch(firm.firmDatabase, {
        kind: body.kind,
        matchValue,
        matterId,
      });
      if (existing !== null) {
        return problemJson(c, {
          type: "auto-file-rule-duplicate",
          title: "That rule already exists",
          status: 409,
          detail:
            existing.state === "revoked"
              ? "This matter already holds a revoked rule with the same condition. Its record is kept " +
                "so the messages it placed stay explicable."
              : "This matter already holds a rule with the same condition.",
        });
      }

      const idempotency = requireChokepointIdempotency(c);
      const now = (): string => new Date().toISOString();
      const ruleId = newIdentifier("emailAutoFileRule");
      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => {
          // ONE instant for the row and for the body. Calling the clock twice would return a
          // `createdAt` the stored row does not carry, and the stored idempotent response would then
          // replay a lie about when the delegation was made.
          const createdAt = now();
          const clock = { now: () => createdAt };
          const write = createEmailAutoFileRule(
            firm.firmDatabase,
            {
              id: ruleId,
              kind: body.kind,
              matterId,
              matchValue,
              promotion,
              createdBy: userId,
              createdFromEmailMessageId: body.createdFromEmailMessageId ?? null,
            },
            { clock, actorUserId: userId },
          );
          const created = presentRule(
            {
              id: ruleId,
              kind: body.kind,
              matterId,
              matchValue,
              promotion,
              state: "active",
              suspendedReason: null,
              createdBy: userId,
              createdFromEmailMessageId: body.createdFromEmailMessageId ?? null,
              createdAt,
            },
            directFilingPermitted,
          );
          return {
            write: { statements: [...write.statements], outboxMessages: [] },
            responseCode: 201,
            responseBody: canonicalJsonStringify(created),
          };
        },
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof AutoFileRule>, 201);
    },
  );

  // GET /matters/{matterId}/auto-file-rules — the list a member prunes.
  app.openapi(
    { ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { matterId } = c.req.valid("param");
      if ((await accessibleMatter(firm, userId, matterId)) === null) return matterNotFound(c);
      const [rules, directFilingPermitted] = await Promise.all([
        readAutoFileRulesForMatter(firm.firmDatabase, matterId, MATTER_RULE_LIMIT),
        readAutoFileDirectFilingPermitted(firm.firmDatabase),
      ]);
      return c.json({ data: rules.map((rule) => presentRule(rule, directFilingPermitted)) }, 200);
    },
  );

  // PATCH /matters/{matterId}/auto-file-rules/{id} — the promotion posture.
  app.openapi(
    { ...updateRoute, middleware: chokepointMiddleware(chokepoint, updateRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { matterId, emailAutoFileRuleId } = c.req.valid("param");
      const { promotion } = c.req.valid("json");
      const resolved = await resolveRuleForMutation(c, matterId, emailAutoFileRuleId);
      if ("refusal" in resolved) return resolved.refusal;
      const rule = resolved.rule;
      if (rule.state !== "active") {
        return notActionable(
          c,
          "Only a rule that is in service can have its posture changed. Resume it first.",
        );
      }
      const directFilingPermitted = await readAutoFileDirectFilingPermitted(firm.firmDatabase);
      if (promotion === "file" && !directFilingPermitted) return directFilingRefused(c);

      const now = (): string => new Date().toISOString();
      const write = updateEmailAutoFileRulePromotion(
        firm.firmDatabase,
        { id: emailAutoFileRuleId, promotion },
        { clock: { now }, actorUserId: userId },
      );
      await commitEffectBatch(
        firm.firmDatabase,
        { statements: [...write.statements], outboxMessages: [] },
        { now },
      );
      return c.json(presentRule({ ...rule, promotion }, directFilingPermitted), 200);
    },
  );

  // POST /matters/{matterId}/auto-file-rules/{id}/suspend — a member stopping a rule by hand. The
  // same transition the circuit breaker performs from the capture path, under a different reason.
  app.openapi(
    { ...suspendRoute, middleware: chokepointMiddleware(chokepoint, suspendRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { matterId, emailAutoFileRuleId } = c.req.valid("param");
      const resolved = await resolveRuleForMutation(c, matterId, emailAutoFileRuleId);
      if ("refusal" in resolved) return resolved.refusal;
      const rule = resolved.rule;
      if (rule.state !== "active") {
        return notActionable(
          c,
          rule.state === "suspended"
            ? "This rule is already out of service."
            : "This rule has been revoked, so there is nothing to suspend.",
        );
      }
      const now = (): string => new Date().toISOString();
      const write = suspendEmailAutoFileRule(
        firm.firmDatabase,
        { id: emailAutoFileRuleId, reason: "member" },
        { clock: { now }, actorUserId: userId },
      );
      await commitEffectBatch(
        firm.firmDatabase,
        { statements: [...write.statements], outboxMessages: [] },
        { now },
      );
      const directFilingPermitted = await readAutoFileDirectFilingPermitted(firm.firmDatabase);
      return c.json(
        presentRule(
          { ...rule, state: "suspended", suspendedReason: "member" },
          directFilingPermitted,
        ),
        200,
      );
    },
  );

  // POST /matters/{matterId}/auto-file-rules/{id}/resume.
  app.openapi(
    { ...resumeRoute, middleware: chokepointMiddleware(chokepoint, resumeRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { matterId, emailAutoFileRuleId } = c.req.valid("param");
      const resolved = await resolveRuleForMutation(c, matterId, emailAutoFileRuleId);
      if ("refusal" in resolved) return resolved.refusal;
      const rule = resolved.rule;
      if (rule.state !== "suspended") {
        return notActionable(
          c,
          rule.state === "active"
            ? "This rule is already in service."
            : "A revoked rule is never put back. Create a new rule instead.",
        );
      }
      const now = (): string => new Date().toISOString();
      const write = resumeEmailAutoFileRule(
        firm.firmDatabase,
        { id: emailAutoFileRuleId },
        { clock: { now }, actorUserId: userId },
      );
      await commitEffectBatch(
        firm.firmDatabase,
        { statements: [...write.statements], outboxMessages: [] },
        { now },
      );
      const directFilingPermitted = await readAutoFileDirectFilingPermitted(firm.firmDatabase);
      return c.json(
        presentRule({ ...rule, state: "active", suspendedReason: null }, directFilingPermitted),
        200,
      );
    },
  );

  // DELETE /matters/{matterId}/auto-file-rules/{id} — revoke, which is still not a delete.
  app.openapi(
    { ...revokeRoute, middleware: chokepointMiddleware(chokepoint, revokeRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { matterId, emailAutoFileRuleId } = c.req.valid("param");
      const resolved = await resolveRuleForMutation(c, matterId, emailAutoFileRuleId);
      if ("refusal" in resolved) return resolved.refusal;
      const rule = resolved.rule;
      if (rule.state === "revoked") {
        return notActionable(c, "This rule has already been revoked.");
      }
      const now = (): string => new Date().toISOString();
      const write = revokeEmailAutoFileRule(
        firm.firmDatabase,
        { id: emailAutoFileRuleId },
        { clock: { now }, actorUserId: userId },
      );
      await commitEffectBatch(
        firm.firmDatabase,
        { statements: [...write.statements], outboxMessages: [] },
        { now },
      );
      const directFilingPermitted = await readAutoFileDirectFilingPermitted(firm.firmDatabase);
      return c.json(
        presentRule({ ...rule, state: "revoked", suspendedReason: null }, directFilingPermitted),
        200,
      );
    },
  );

  // GET /emails/{emailMessageId}/auto-file-decisions — "why did this file itself".
  app.openapi(
    { ...decisionsRoute, middleware: chokepointMiddleware(chokepoint, decisionsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { emailMessageId } = c.req.valid("param");
      const message = await readMessageById(firm.firmDatabase, emailMessageId);
      if (message === null) {
        return problemJson(c, {
          type: "not-found",
          title: "Email not found",
          status: 404,
          detail: "No such email, or you cannot access it.",
        });
      }
      // The same absence answer the single-message read gives: a caller walled from every matter the
      // message is filed to learns nothing, not even that it exists.
      const filed = await filedMatterIdsForMessage(firm.firmDatabase, emailMessageId);
      const visibleFiled = await filterAccessibleMatters(firm, userId, filed);
      if (filed.length > 0 && visibleFiled.length === 0) {
        return problemJson(c, {
          type: "not-found",
          title: "Email not found",
          status: 404,
          detail: "No such email, or you cannot access it.",
        });
      }

      // One row past the ceiling, purely to learn whether there was one. The extra row is discarded
      // before anything else looks at it, so it can never reach the wall or the answer.
      const read = await readAutoFileDecisionsForMessage(
        firm.firmDatabase,
        emailMessageId,
        MESSAGE_DECISION_LIMIT + 1,
      );
      const decisionsCapped = read.length > MESSAGE_DECISION_LIMIT;
      const decisions = read.slice(0, MESSAGE_DECISION_LIMIT);
      // Narrow the matters the decisions name BEFORE anything is rendered. A decision about a matter
      // the caller cannot open is dropped whole — it would otherwise name that matter's identity in a
      // read whose subject is a message the caller can legitimately see.
      const namedMatters = [
        ...new Set(
          decisions
            .map((decision) => decision.matterId)
            .filter((matterId): matterId is MatterId => matterId !== null),
        ),
      ];
      const visible = new Set(await filterAccessibleMatters(firm, userId, namedMatters));
      const ruleIds = [
        ...new Set(
          decisions
            .map((decision) => decision.autoFileRuleId)
            .filter((ruleId): ruleId is EmailAutoFileRuleId => ruleId !== null),
        ),
      ];
      const rules = new Map(
        (await readAutoFileRulesByIds(firm.firmDatabase, ruleIds)).map((rule) => [rule.id, rule]),
      );

      const data = decisions
        .filter((decision) => decision.matterId === null || visible.has(decision.matterId))
        .map((decision) => {
          const evidence = parseEvidence(decision.evidence);
          return {
            emailAutoFileDecisionId: decision.id,
            emailAutoFileRuleId: decision.autoFileRuleId,
            matterId: decision.matterId,
            outcome: decision.outcome,
            suppressionReason: decision.suppressionReason,
            demotionReason: evidence.demotionReason,
            reasons: [
              ...describeAutoFileDecisionRecord({
                outcome: decision.outcome,
                suppressionReason: decision.suppressionReason,
                demotionReason: evidence.demotionReason,
                ruleKind:
                  decision.autoFileRuleId === null
                    ? null
                    : (rules.get(decision.autoFileRuleId)?.kind ?? null),
              }),
            ],
            createdAt: decision.createdAt,
          };
        });
      return c.json({ data, capped: decisionsCapped }, 200);
    },
  );

  // GET /emails/auto-file-review — what the rules have been doing, per rule.
  app.openapi(
    { ...reviewRoute, middleware: chokepointMiddleware(chokepoint, reviewRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const windowStart = new Date(
        Date.now() - REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      // NARROW FIRST, COUNT SECOND. The matter set goes through the one wall filter before anything
      // else is read, so a rule on a matter the caller cannot open contributes no entry, no count and
      // no suspension line — it is not filtered out of a rendered answer, it never enters one.
      const touched = await readAutoFileRuleMatterIds(firm.firmDatabase, {
        limit: REVIEW_MATTER_LIMIT,
      });
      const visible = await filterAccessibleMatters(firm, userId, touched.matterIds);
      // Counted in SQL over the matters that survived the wall, so the numbers are exact however much
      // the rules have been doing. They used to be tallied from a capped page of links, which both
      // understated every count and dropped a matter whose links all fell past the cut.
      const tallies = await readAutomaticRuleTallies(firm.firmDatabase, {
        since: windowStart,
        matterIds: visible,
      });

      const rules = new Map(
        (
          await readAutoFileRulesByIds(
            firm.firmDatabase,
            tallies.map((tally) => tally.autoFileRuleId),
          )
        ).map((rule) => [rule.id, rule]),
      );

      const data = tallies
        .flatMap((tally) => {
          const rule = rules.get(tally.autoFileRuleId);
          // A link naming a rule row that is not there cannot be explained, so it is not reported.
          // Reporting the tally without the rule would be an entry nobody can act on.
          if (rule === undefined) return [];
          return [
            {
              emailAutoFileRuleId: rule.id,
              kind: rule.kind,
              matterId: rule.matterId,
              promotion: rule.promotion,
              state: rule.state,
              suspendedReason: rule.suspendedReason,
              filedCount: tally.filedCount,
              stagedCount: tally.stagedCount,
              undoneCount: tally.undoneCount,
              lastActedAt: tally.lastActedAt,
            },
          ];
        })
        .toSorted((left, right) => right.lastActedAt.localeCompare(left.lastActedAt));
      return c.json({ windowStart, matterScopeCapped: touched.capped, data }, 200);
    },
  );
}

// The stored evidence blob, read defensively. It holds identifiers and enums by construction, but it
// is a text column: a row this build cannot parse yields no demotion reason rather than a thrown read,
// because the answer to "why is this here" degrading to a shorter answer is recoverable and losing the
// whole page is not.
function parseEvidence(raw: string): { demotionReason: string | null } {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { demotionReason: null };
    const value = (parsed as Record<string, unknown>)["demotionReason"];
    return { demotionReason: typeof value === "string" ? value : null };
  } catch {
    return { demotionReason: null };
  }
}
