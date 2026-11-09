import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import {
  mergeNotificationPreferences,
  readFirmNotificationPreferences,
  writeFirmNotificationPreferencesStatement,
} from "@magna-carta/notifications/preferences";
import {
  readNotificationDigestLocalHour,
  readNotificationRetentionDays,
  writeNotificationDigestLocalHourStatement,
  writeNotificationRetentionDaysStatement,
} from "@magna-carta/notifications/settings";
import {
  MAX_DIGEST_LOCAL_HOUR,
  MAX_RETENTION_DAYS,
  MIN_DIGEST_LOCAL_HOUR,
  MIN_RETENTION_DAYS,
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

// THE FIRM'S NOTIFICATION POLICY — the three levers a firm holds over what the platform tells its
// members, kept apart from `/api/v1/notifications/preferences`, which is one member's own switches.
//
// The separation is not cosmetic. In app, the firm's tier is a FLOOR: a category the firm sets `on`
// reaches every member and no member may switch it back off. The retention window decides how long
// every member's pointers survive. The digest hour decides when the firm's summary mail lands. All
// three are firm-administration acts that bind people other than the actor, so they sit behind
// `firm:manageNotificationPolicy` (Owner/Admin by seed) rather than the member key `notifications:read`,
// which every default role including Read-only carries because reading one's own feed is not a
// privilege. The two channels still compose in opposite directions — a firm may raise the in-app
// floor and may never raise a member's email cadence — and that composition is decided in exactly
// one place, `resolveCategoryPreference` in `@magna-carta/notifications`, which this surface only
// supplies a tier to.
//
// What is deliberately NOT here: the trust-compliance designation. It is a firm setting too, but it
// names PEOPLE rather than policy, and it already lives behind `trust:manage` on the preferences
// route beside the read that answers it.

const PERMISSION = "firm:manageNotificationPolicy" as const;

const CategoryEnum = z.enum(NOTIFICATION_CATEGORIES);
const InAppEnum = z.enum(NOTIFICATION_IN_APP_CHOICES);
const CadenceEnum = z.enum(NOTIFICATION_EMAIL_CADENCES);

// The firm's stored tier for one category, unresolved. Null on a channel means the firm has expressed
// nothing there — a different fact from the firm having chosen today's platform recommendation, and
// the reason a stored value is a sparse patch rather than an expanded matrix.
const FirmCategoryPolicy = z
  .object({
    category: CategoryEnum,
    inApp: InAppEnum.nullable(),
    email: CadenceEnum.nullable(),
  })
  .openapi("FirmNotificationCategoryPolicy");

const FirmNotificationPolicyResponse = z
  .object({
    categories: z.array(FirmCategoryPolicy),
    retentionDays: z.number().int(),
    digestLocalHour: z.number().int(),
  })
  .openapi("FirmNotificationPolicyResponse");

const PatchFirmNotificationPolicyRequest = z
  .object({
    // Sparse, exactly as the member's own patch is: a category absent is unchanged, and a channel set
    // to null CLEARS the firm's choice so the platform's recommendation applies again. Clearing has to
    // be expressible or a firm that once raised a floor could never lower it back to a default.
    categories: z
      .partialRecord(
        CategoryEnum,
        z.object({
          inApp: InAppEnum.nullable().optional(),
          email: CadenceEnum.nullable().optional(),
        }),
      )
      .optional(),
    // Refused outside the declared bounds rather than clamped. Below thirty days a member returning
    // from two weeks' leave opens an empty feed; above a year the feed is an unbounded read and every
    // extra day is another day a pointer outlives the access check that justified writing it. A firm
    // that asked for five years and silently got one would believe it had the first.
    retentionDays: z.number().int().min(MIN_RETENTION_DAYS).max(MAX_RETENTION_DAYS).optional(),
    digestLocalHour: z
      .number()
      .int()
      .min(MIN_DIGEST_LOCAL_HOUR)
      .max(MAX_DIGEST_LOCAL_HOUR)
      .optional(),
  })
  .openapi("PatchFirmNotificationPolicyRequest");

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
    description: "The session member lacks firm:manageNotificationPolicy",
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

const getMeta: RouteMeta = {
  operationId: "firmNotificationPolicy.get",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const patchMeta: RouteMeta = {
  operationId: "firmNotificationPolicy.update",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  // Audited. A firm raising the in-app floor changes what its members hear, and shortening the
  // retention window destroys pointers on a clock nobody watches; both are facts a later "why am I
  // being told this" or "where did my notifications go" conversation turns on. The metadata is the
  // policy itself — categories, an integer of days, an integer hour — and never a member, a subject,
  // or a matter.
  audited: true,
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "default",
};

const getRoute = defineOpenAPIRoute(getMeta, {
  method: "get",
  path: "/api/v1/firm/notifications/policy",
  description:
    "Reads the firm's notification policy: what the firm has set per category (null on a channel " +
    "means the firm has set nothing there and the platform's recommendation applies), how long " +
    "notifications are kept, and the local hour the firm's summary email is sent. In app the firm's " +
    "setting is a floor a member cannot lower; by email it is only a default a member's own choice " +
    "overrides. This is the firm's tier only — it is not what any particular member sees.",
  responses: {
    200: {
      description: "The firm's notification policy",
      content: { "application/json": { schema: FirmNotificationPolicyResponse } },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    429: errorResponses[429],
  },
});

const patchRoute = defineOpenAPIRoute(patchMeta, {
  method: "patch",
  path: "/api/v1/firm/notifications/policy",
  description:
    "Updates one or more of the firm's notification policy settings. Sparse: an absent field is left " +
    "alone, and a category channel set to null clears the firm's choice so the platform's " +
    "recommendation applies again. Setting a category on in app raises the firm's floor, which no " +
    "member can lower; setting an email cadence sets a default that any member can override, because " +
    "a firm cannot make somebody's mailbox carry more. A retention window or digest hour outside the " +
    "permitted range is refused, never quietly adjusted. Returns the firm's full policy after the write.",
  request: {
    headers: idempotencyKeyHeader,
    body: {
      required: true,
      content: { "application/json": { schema: PatchFirmNotificationPolicyRequest } },
    },
  },
  responses: {
    200: {
      description: "The firm's notification policy after the write",
      content: { "application/json": { schema: FirmNotificationPolicyResponse } },
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

type PolicyApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

type PolicyBody = z.infer<typeof FirmNotificationPolicyResponse>;

type FirmDatabase = Parameters<typeof readFirmNotificationPreferences>[0];

// Every category is reported, including the ones the firm has said nothing about, so a surface
// rendering the policy never has to decide whether an absent key means "off" or "unset". Null is what
// says unset, and it is on the wire rather than inferred from a missing entry.
async function readPolicyBody(database: FirmDatabase): Promise<PolicyBody> {
  const [stored, retentionDays, digestLocalHour] = await Promise.all([
    readFirmNotificationPreferences(database),
    readNotificationRetentionDays(database),
    readNotificationDigestLocalHour(database),
  ]);
  return {
    categories: NOTIFICATION_CATEGORIES.map((category) => ({
      category,
      inApp: stored[category]?.inApp ?? null,
      email: stored[category]?.email ?? null,
    })),
    retentionDays,
    digestLocalHour,
  };
}

export function registerFirmNotificationPolicyRoutes(app: PolicyApp, chokepoint: Chokepoint): void {
  // GET /api/v1/firm/notifications/policy
  app.openapi(
    { ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      return c.json(await readPolicyBody(firm.firmDatabase), 200);
    },
  );

  // PATCH /api/v1/firm/notifications/policy
  app.openapi(
    { ...patchRoute, middleware: chokepointMiddleware(chokepoint, patchRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const actorUserId = requireChokepointUserId(c);
      const body = c.req.valid("json");

      const touchedCategories = Object.keys(body.categories ?? {}) as NotificationCategory[];
      if (
        touchedCategories.length === 0 &&
        body.retentionDays === undefined &&
        body.digestLocalHour === undefined
      ) {
        // An empty patch changes nothing and must not add an audit row: a redelivered no-op would
        // otherwise put a policy change in the log that nobody made.
        return c.json(await readPolicyBody(firm.firmDatabase), 200);
      }

      const idempotency = requireChokepointIdempotency(c);
      const now = () => new Date().toISOString();
      const stored = await readFirmNotificationPreferences(firm.firmDatabase);
      const merged = mergeNotificationPreferences(stored, body.categories ?? {});

      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => {
          const timestamp = now();
          const statements = [
            ...(touchedCategories.length > 0
              ? [writeFirmNotificationPreferencesStatement(firm.firmDatabase, merged, timestamp)]
              : []),
            ...(body.retentionDays !== undefined
              ? [
                  writeNotificationRetentionDaysStatement(
                    firm.firmDatabase,
                    body.retentionDays,
                    timestamp,
                  ),
                ]
              : []),
            ...(body.digestLocalHour !== undefined
              ? [
                  writeNotificationDigestLocalHourStatement(
                    firm.firmDatabase,
                    body.digestLocalHour,
                    timestamp,
                  ),
                ]
              : []),
          ];
          return {
            write: {
              statements: [
                ...statements,
                insertAuditLogStatement(firm.firmDatabase, {
                  id: newIdentifier("auditLog"),
                  event: "firm.notification_policy_updated",
                  actorUserId,
                  subjectId: null,
                  // The patch as submitted — closed enum labels and two integers. There is nothing
                  // here a person typed, so the redact-by-default rule is satisfied structurally
                  // rather than by remembering to strip a field.
                  metadata: body,
                  now: timestamp,
                }),
              ],
              outboxMessages: [],
            },
            responseCode: 200,
            // Composed from the merged value rather than re-read: the read inside this effect would
            // not yet see its own uncommitted write. Every field is stored as given, so this agrees
            // with what the next GET returns.
            responseBody: canonicalJsonStringify(merged),
          };
        },
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(await readPolicyBody(firm.firmDatabase), 200);
    },
  );
}
