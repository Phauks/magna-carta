import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import {
  mergeNotificationPreferences,
  readMemberNotificationPreferences,
  readTrustComplianceRecipients,
  resolveCategoryPreference,
  resolveNotificationPreferencesForMember,
  writeMemberNotificationPreferencesStatement,
  writeTrustComplianceRecipientsStatement,
  MAX_TRUST_COMPLIANCE_RECIPIENTS,
} from "@magna-carta/notifications/preferences";
import { readNotificationRetentionDays } from "@magna-carta/notifications/settings";
import {
  selectInAppSuppressionStatement,
  type InAppSuppressionRawRow,
} from "@magna-carta/notifications/suppression-statements";
import {
  IN_APP_SUPPRESSION_REASONS,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_EMAIL_CADENCES,
  NOTIFICATION_IN_APP_CHOICES,
  type NotificationCategory,
} from "@magna-carta/notifications/types";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader } from "../../contracts/common.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// WHO HEARS WHAT: the member's own per-category matrix, and the firm's two levers over it.
//
// Two channels that compose in opposite directions, which is the whole content of this surface. In
// app, the firm's tier is a FLOOR: a firm may insist a category reaches its members, and a member
// may not switch that back off. By email, the member's tier WINS: a firm may not force a cadence
// upward, because forcing email is forcing privileged-adjacent metadata into a mailbox that may be
// personal, may be outside the firm's administration, and is beyond both the audit log and the
// visibility filter. Above both, two categories are non-silenceable in app whatever either tier
// says.
//
// Nothing here is a screen. These are the reads and writes a preference surface will consume when
// one is built; the shipped stub stays a stub until then.

const MEMBER_PREFERENCES = "notifications:read" as const;
// A member configuring their own feed is the same self-scoped act as reading it and settling a row
// on it, which this subsystem already gates on this one key — and the capability registry
// deliberately declines a second `notifications:manage` beside it. Gating a member's own switches
// behind an administrative key would mean a firm whose staff cannot turn off their own email.
const TRUST_DESIGNATION = "trust:manage" as const;

const CategoryEnum = z.enum(NOTIFICATION_CATEGORIES);
const InAppEnum = z.enum(NOTIFICATION_IN_APP_CHOICES);
const CadenceEnum = z.enum(NOTIFICATION_EMAIL_CADENCES);

const MemberChoice = z
  .object({ inApp: InAppEnum.optional(), email: CadenceEnum.optional() })
  .openapi("NotificationCategoryChoice");

const ResolvedCategory = z
  .object({
    category: CategoryEnum,
    // What applies. Not necessarily what the member asked for — see `inAppLockedBy`.
    inApp: InAppEnum,
    email: CadenceEnum,
    // Why the in-app switch cannot be moved, where it cannot. `mandatory` is the platform's floor on
    // the two categories that mirror the non-optional stance of the audit log; `firm-policy` is a
    // firm raising the floor for itself. Null means the member decides.
    inAppLockedBy: z.enum(["mandatory", "firm-policy"]).nullable(),
    // The raw tiers, so a surface can show what the member chose as distinct from what applies.
    memberChoice: MemberChoice.nullable(),
    firmChoice: MemberChoice.nullable(),
  })
  .openapi("NotificationResolvedCategoryPreference");

const SuppressionTally = z
  .object({
    category: CategoryEnum,
    reason: z.enum(IN_APP_SUPPRESSION_REASONS),
    count: z.number().int(),
    lastSuppressedAt: z.string(),
  })
  .openapi("NotificationSuppressionTally");

const PreferencesResponse = z
  .object({
    categories: z.array(ResolvedCategory),
    // WHAT THE CHOICE HAS COST, reported back to the member who made it. A preference system's
    // failure mode is silence: something that should have arrived did not, and nothing says a
    // setting is the reason. These counts are what make a suppression a fact rather than an
    // absence — and they are the member's own, never a colleague's.
    suppressedInApp: z.array(SuppressionTally),
    // How far back the counts reach: the firm's notification retention window, since the tally ages
    // out on the same clock as the notifications it accounts for.
    suppressedSinceCivilDate: z.string(),
  })
  .openapi("NotificationPreferencesResponse");

const PatchPreferencesRequest = z
  .object({
    // A sparse patch. A category absent is unchanged; a field within a present category set to null
    // CLEARS the member's own choice for that channel, falling back to the firm's tier and then to
    // the platform's recommendation. Clearing has to be expressible or a member who once chose the
    // current recommendation could never go back to following it.
    // A PARTIAL record, not a record: zod's plain record over an enum key demands every member of
    // the enum, which would turn every one-switch change into a client resending the whole matrix.
    categories: z.partialRecord(
      CategoryEnum,
      z.object({
        inApp: InAppEnum.nullable().optional(),
        email: CadenceEnum.nullable().optional(),
      }),
    ),
  })
  .openapi("PatchNotificationPreferencesRequest");

const TrustComplianceRecipientsResponse = z
  .object({ recipientUserIds: z.array(z.string()) })
  .openapi("TrustComplianceRecipientsResponse");

const PutTrustComplianceRecipientsRequest = z
  .object({
    recipientUserIds: z.array(z.string().min(1)).max(MAX_TRUST_COMPLIANCE_RECIPIENTS),
  })
  .openapi("PutTrustComplianceRecipientsRequest");

const errorResponses = {
  400: {
    description: "The Idempotency-Key header is missing on a write",
    content: { "application/problem+json": { schema: Problem } },
  },
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks the required permission",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable or the member is deactivated",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description: "A request with this Idempotency-Key is already in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request body is invalid, or the Idempotency-Key was reused with a different body",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const getPreferencesMeta: RouteMeta = {
  operationId: "notificationPreferences.get",
  surface: "app",
  authenticated: true,
  permission: MEMBER_PREFERENCES,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const getPreferencesRoute = defineOpenAPIRoute(getPreferencesMeta, {
  method: "get",
  path: "/api/v1/notifications/preferences",
  description:
    "Returns the session member's own notification preferences, resolved per category: what applies, " +
    "whether the in-app switch is locked and by whom, and the raw member and firm choices behind it. " +
    "Two categories are always on in app. A firm may raise the in-app floor for a category and can " +
    "never raise a member's email cadence. Also returns how many notifications the member's own " +
    "settings have stopped, per category, within the firm's retention window.",
  responses: {
    200: {
      description: "The member's resolved notification preferences",
      content: { "application/json": { schema: PreferencesResponse } },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    429: errorResponses[429],
  },
});

const patchPreferencesMeta: RouteMeta = {
  operationId: "notificationPreferences.update",
  surface: "app",
  authenticated: true,
  permission: MEMBER_PREFERENCES,
  resource: "firm",
  // Audited, unlike the three feed-settling routes beside it. Those record a member glancing at a
  // badge; this records a member changing what the platform will and will not tell them, which is
  // the fact a later "nobody told me" conversation turns on. Metadata is the category and the
  // resolved values, and never a subject, a matter, or anyone else's identity.
  audited: true,
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "default",
};

const patchPreferencesRoute = defineOpenAPIRoute(patchPreferencesMeta, {
  method: "patch",
  path: "/api/v1/notifications/preferences",
  description:
    "Updates the session member's own notification preferences. Sparse: a category absent is left " +
    "alone, a field set to null clears the member's choice for that channel so the firm's setting and " +
    "then the platform default apply again. Setting a mandatory category off in app is accepted and " +
    "stored but does not take effect — the response reports what actually applies. Returns the full " +
    "re-resolved matrix.",
  request: {
    headers: idempotencyKeyHeader,
    body: {
      required: true,
      content: { "application/json": { schema: PatchPreferencesRequest } },
    },
  },
  responses: {
    200: {
      description: "The member's re-resolved notification preferences",
      content: { "application/json": { schema: PreferencesResponse } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const getDesignationMeta: RouteMeta = {
  operationId: "notificationPreferences.getTrustComplianceRecipients",
  surface: "app",
  authenticated: true,
  permission: TRUST_DESIGNATION,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const getDesignationRoute = defineOpenAPIRoute(getDesignationMeta, {
  method: "get",
  path: "/api/v1/firm/notifications/trust-compliance-recipients",
  description:
    "Returns the members the firm has designated to hear about every trust-category notification, in " +
    "addition to whoever each kind's own audience already reaches. An empty list is the default and " +
    "means nobody is designated.",
  responses: {
    200: {
      description: "The firm's designated trust-compliance recipients",
      content: { "application/json": { schema: TrustComplianceRecipientsResponse } },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    429: errorResponses[429],
  },
});

const putDesignationMeta: RouteMeta = {
  operationId: "notificationPreferences.setTrustComplianceRecipients",
  surface: "app",
  authenticated: true,
  permission: TRUST_DESIGNATION,
  resource: "firm",
  audited: true,
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "default",
};

const putDesignationRoute = defineOpenAPIRoute(putDesignationMeta, {
  method: "put",
  path: "/api/v1/firm/notifications/trust-compliance-recipients",
  description:
    "Replaces the firm's designated trust-compliance recipients. A designation is not a grant of " +
    "access: a designated member is added to the recipient set and nothing else, so a notification " +
    "about a matter they may not see is simply not on their feed and not in their count, with no " +
    "placeholder standing in for it. The audit record carries how many members were designated and " +
    "never who they are.",
  request: {
    headers: idempotencyKeyHeader,
    body: {
      required: true,
      content: { "application/json": { schema: PutTrustComplianceRecipientsRequest } },
    },
  },
  responses: {
    200: {
      description: "The firm's designated trust-compliance recipients after the write",
      content: { "application/json": { schema: TrustComplianceRecipientsResponse } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

type PreferencesApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

type PreferencesBody = z.infer<typeof PreferencesResponse>;

async function readPreferencesBody(
  database: Parameters<typeof readNotificationRetentionDays>[0],
  sessionUserId: string,
): Promise<PreferencesBody> {
  const [resolved, retentionDays] = await Promise.all([
    resolveNotificationPreferencesForMember(database, sessionUserId),
    readNotificationRetentionDays(database),
  ]);
  const sinceCivilDate = new Date(Date.now() - retentionDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const { results } = await selectInAppSuppressionStatement(
    database,
    sessionUserId,
    sinceCivilDate,
  ).all<InAppSuppressionRawRow>();

  return {
    categories: NOTIFICATION_CATEGORIES.map((category) => {
      const entry = resolved.get(category);
      return {
        category,
        inApp: entry?.inApp ?? "on",
        email: entry?.email ?? "daily",
        inAppLockedBy: entry?.inAppLockedBy ?? null,
        memberChoice: entry?.memberChoice ?? null,
        firmChoice: entry?.firmChoice ?? null,
      };
    }),
    suppressedInApp: results.map((row) => ({
      category: row.category as NotificationCategory,
      reason: row.reason as (typeof IN_APP_SUPPRESSION_REASONS)[number],
      count: row.suppressed_count,
      lastSuppressedAt: row.last_suppressed_at,
    })),
    suppressedSinceCivilDate: sinceCivilDate,
  };
}

export function registerNotificationPreferencesRoutes(
  app: PreferencesApp,
  chokepoint: Chokepoint,
): void {
  // GET /api/v1/notifications/preferences
  app.openapi(
    { ...getPreferencesRoute, middleware: chokepointMiddleware(chokepoint, getPreferencesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      // The SESSION's user and never a path parameter, exactly as the feed reads are scoped. How
      // much somebody has chosen not to hear is their own fact, not a colleague's to look up.
      const sessionUserId = requireChokepointUserId(c);
      return c.json(await readPreferencesBody(firm.firmDatabase, sessionUserId), 200);
    },
  );

  // PATCH /api/v1/notifications/preferences
  app.openapi(
    {
      ...patchPreferencesRoute,
      middleware: chokepointMiddleware(chokepoint, patchPreferencesRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const sessionUserId = requireChokepointUserId(c);
      const body = c.req.valid("json");

      if (Object.keys(body.categories).length === 0) {
        // An empty patch changes nothing and must not add an audit row: a redelivered no-op would
        // otherwise put a preference change in the log that nobody made.
        return c.json(await readPreferencesBody(firm.firmDatabase, sessionUserId), 200);
      }

      const idempotency = requireChokepointIdempotency(c);
      const now = () => new Date().toISOString();
      const [stored, currentlyResolved] = await Promise.all([
        readMemberNotificationPreferences(firm.firmDatabase, sessionUserId),
        resolveNotificationPreferencesForMember(firm.firmDatabase, sessionUserId),
      ]);
      // The same merge the firm's own policy patch uses (`firm-notification-policy.ts`) — one notion
      // of what clearing a channel means, for both tiers.
      const merged = mergeNotificationPreferences(stored, body.categories);

      // What each touched category will actually resolve to once the write lands — computed rather
      // than echoed, because the firm's tier and the mandatory floor both have a say and an audit
      // row repeating the request would record a trust category as silenced when it is not. The
      // firm's tier comes off the current resolution, which is the only tier the member's write
      // does not move.
      const auditedCategories = (Object.keys(body.categories) as NotificationCategory[])
        .sort()
        .map((category) => {
          const resolved = resolveCategoryPreference(
            category,
            merged[category] ?? null,
            currentlyResolved.get(category)?.firmChoice ?? null,
          );
          return { category, inApp: resolved.inApp, email: resolved.email };
        });

      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => {
          const timestamp = now();
          // The write and its audit row ride ONE batch. Re-resolving afterwards rather than
          // predicting the answer is deliberate: what applies is the composition of both tiers and
          // the mandatory floor, and a response that echoed the request would tell a member their
          // trust category is off when it is not.
          const write = {
            statements: [
              writeMemberNotificationPreferencesStatement(
                firm.firmDatabase,
                sessionUserId,
                merged,
                timestamp,
              ),
              insertAuditLogStatement(firm.firmDatabase, {
                id: newIdentifier("auditLog"),
                event: "notifications.preferences_updated",
                actorUserId: sessionUserId,
                subjectId: null,
                // The categories touched and what each now resolves to — metadata only. Never a
                // notification, a subject, a matter, or anyone else's identity: the rule the
                // custody register states applies verbatim, and a preference change is about the
                // actor and nothing else.
                metadata: { categories: auditedCategories },
                now: timestamp,
              }),
            ],
            outboxMessages: [],
          };
          return {
            write,
            responseCode: 200,
            // Composed from the merged value rather than re-read, because the read inside this
            // effect would not yet see its own uncommitted write. The resolution is pure given the
            // two tiers, so it agrees with what the next GET returns.
            responseBody: canonicalJsonStringify(merged),
          };
        },
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(await readPreferencesBody(firm.firmDatabase, sessionUserId), 200);
    },
  );

  // GET /api/v1/firm/notifications/trust-compliance-recipients
  app.openapi(
    { ...getDesignationRoute, middleware: chokepointMiddleware(chokepoint, getDesignationRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const recipientUserIds = await readTrustComplianceRecipients(firm.firmDatabase);
      return c.json({ recipientUserIds: [...recipientUserIds] }, 200);
    },
  );

  // PUT /api/v1/firm/notifications/trust-compliance-recipients
  app.openapi(
    { ...putDesignationRoute, middleware: chokepointMiddleware(chokepoint, putDesignationRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const actorUserId = requireChokepointUserId(c);
      const body = c.req.valid("json");
      const idempotency = requireChokepointIdempotency(c);
      const now = () => new Date().toISOString();

      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => {
          const timestamp = now();
          return {
            write: {
              statements: [
                writeTrustComplianceRecipientsStatement(
                  firm.firmDatabase,
                  body.recipientUserIds,
                  timestamp,
                ),
                insertAuditLogStatement(firm.firmDatabase, {
                  id: newIdentifier("auditLog"),
                  event: "notifications.trust_compliance_recipients_updated",
                  actorUserId,
                  subjectId: null,
                  // HOW MANY, never who. A recipient list in the audit log would be a durable
                  // record of who the firm watches its trust account through, kept in the one
                  // table a firm's staff can read.
                  metadata: { recipientCount: new Set(body.recipientUserIds).size },
                  now: timestamp,
                }),
              ],
              outboxMessages: [],
            },
            responseCode: 200,
            responseBody: canonicalJsonStringify({
              recipientUserIds: [...new Set(body.recipientUserIds)].sort(),
            }),
          };
        },
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(
        JSON.parse(result.responseBody ?? "{}") as z.infer<
          typeof TrustComplianceRecipientsResponse
        >,
        200,
      );
    },
  );
}
