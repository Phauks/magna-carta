import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import {
  readFirmSetting,
  writeFirmSettingStatement,
} from "@magna-carta/data-access/setting-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import {
  connectedOutsideServices,
  OUTSIDE_SERVICE_KINDS,
  type OutsideServiceKind,
} from "@magna-carta/signing/outside-service";
import {
  offeredChecks,
  SIGNER_CHECKS,
  startingCheck,
  type SignerCheck,
  type SignerCheckChoice,
} from "@magna-carta/signing/signer-checks";
import type { Bindings } from "../../../bindings.ts";
import {
  signerCheckChoiceDefinition,
  signerCheckReadiness,
} from "../../../signing/signer-check-settings.ts";
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

// THE FIRM'S SIGNING SETTINGS: which ways an outside signer may prove who they are.
//
// The email link is every outside signer's floor and is not a switch. On top of it a firm turns on a
// code by email, a code by text message, and a check run by an outside identity service, and picks
// which one a new signer starts with. The choice is stored as one firm setting
// (signing/signer-check-settings.ts); this route is its only writer.
//
// Beside the switches ride facts this route never writes, because a switch alone would let a firm
// believe something untrue: whether this deployment's text service is set up, and which outside
// services are connected. A firm can turn text codes on before the service is ready; `offered` then
// leaves them out, and that list is what the chooser shows.
//
// The read is open to anyone who sends documents for signature, because the chooser needs `offered`
// and `startWith`; the write is the firm's decision and needs esign:manageSettings.

const CHECK = z.enum(SIGNER_CHECKS as readonly [SignerCheck, ...SignerCheck[]]);
const SERVICE_KIND = z.enum(
  OUTSIDE_SERVICE_KINDS as readonly [OutsideServiceKind, ...OutsideServiceKind[]],
);

const SigningSettingsResponse = z
  .object({
    emailCode: z.boolean(),
    textCode: z.boolean(),
    identityCheck: z.boolean(),
    // What the firm chose for a new signer to start with.
    startWith: CHECK,
    // What a new signer actually starts with today: the firm's pick when it is offered, else the
    // email link.
    startingCheck: CHECK,
    // The checks a member may pick now: turned on and ready to run.
    offered: z.array(CHECK),
    // Whether this deployment can send a text message at all.
    textServiceReady: z.boolean(),
    outsideServices: z.array(
      z.object({ kind: SERVICE_KIND, connected: z.boolean(), vendor: z.string().nullable() }),
    ),
  })
  .openapi("SigningSettingsResponse");

const PatchSigningSettingsRequest = z
  .object({
    // Sparse: an absent field is unchanged, and an empty patch writes nothing and audits nothing.
    emailCode: z.boolean().optional(),
    textCode: z.boolean().optional(),
    identityCheck: z.boolean().optional(),
    startWith: CHECK.optional(),
  })
  .openapi("PatchSigningSettingsRequest");

function problem(description: string) {
  return { description, content: { "application/problem+json": { schema: Problem } } };
}

const common = {
  401: problem("No valid session"),
  404: problem("The firm is unreachable or the member is deactivated"),
  429: problem("Rate limit exceeded"),
} as const;

const getMeta: RouteMeta = {
  operationId: "signingSettings.get",
  surface: "app",
  authenticated: true,
  permission: "esign:send",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const patchMeta: RouteMeta = {
  operationId: "signingSettings.update",
  surface: "app",
  authenticated: true,
  permission: "esign:manageSettings",
  resource: "firm",
  // Audited: the record of who decided what the firm's signers must prove, and when. The metadata is
  // the patch itself: three booleans and a check name, nothing a person typed.
  audited: true,
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "default",
};

const getRoute = defineOpenAPIRoute(getMeta, {
  method: "get",
  path: "/api/v1/firm/signing/settings",
  description:
    "Reads which ways the firm's outside signers may prove who they are (a code by email, a code " +
    "by text message, an outside identity check), which one a new signer starts with, and which are " +
    "offered now. Beside them, two facts this route never writes: whether this deployment can send " +
    "a text message, and which outside services are connected.",
  responses: {
    200: {
      description: "The firm's signing settings",
      content: { "application/json": { schema: SigningSettingsResponse } },
    },
    403: problem("The session member lacks esign:send"),
    ...common,
  },
});

const patchRoute = defineOpenAPIRoute(patchMeta, {
  method: "patch",
  path: "/api/v1/firm/signing/settings",
  description:
    "Updates which ways the firm's outside signers may prove who they are. Sparse: an absent field " +
    "is left alone, and an empty patch changes nothing and records nothing. Returns the settings " +
    "after the write.",
  request: {
    headers: idempotencyKeyHeader,
    body: {
      required: true,
      content: { "application/json": { schema: PatchSigningSettingsRequest } },
    },
  },
  responses: {
    200: {
      description: "The firm's signing settings after the write",
      content: { "application/json": { schema: SigningSettingsResponse } },
    },
    400: problem("The Idempotency-Key header is missing"),
    403: problem("The session member lacks esign:manageSettings"),
    409: problem("A request with this Idempotency-Key is already in progress"),
    422: problem(
      "The request body is invalid, or the Idempotency-Key was reused with a different body",
    ),
    ...common,
  },
});

type SigningSettingsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;
type SigningSettingsBody = z.infer<typeof SigningSettingsResponse>;

function now(): string {
  return new Date().toISOString();
}

function settingsBody(env: Bindings, choice: SignerCheckChoice): SigningSettingsBody {
  const readiness = signerCheckReadiness(env);
  const connected = connectedOutsideServices();
  return {
    emailCode: choice.emailCode,
    textCode: choice.textCode,
    identityCheck: choice.identityCheck,
    startWith: choice.startWith,
    startingCheck: startingCheck(choice, readiness),
    offered: offeredChecks(choice, readiness),
    textServiceReady: readiness.textService,
    outsideServices: OUTSIDE_SERVICE_KINDS.map((kind) => ({
      kind,
      connected: connected.has(kind),
      vendor: connected.get(kind)?.vendor ?? null,
    })),
  };
}

export function registerSigningSettingsRoutes(
  app: SigningSettingsApp,
  chokepoint: Chokepoint,
): void {
  // GET /api/v1/firm/signing/settings
  app.openapi(
    { ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const choice = await readFirmSetting(firm.firmDatabase, signerCheckChoiceDefinition);
      return c.json(settingsBody(c.env, choice), 200);
    },
  );

  // PATCH /api/v1/firm/signing/settings
  app.openapi(
    { ...patchRoute, middleware: chokepointMiddleware(chokepoint, patchRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const actorUserId = requireChokepointUserId(c);
      const body = c.req.valid("json");
      const stored = await readFirmSetting(firm.firmDatabase, signerCheckChoiceDefinition);
      if (
        body.emailCode === undefined &&
        body.textCode === undefined &&
        body.identityCheck === undefined &&
        body.startWith === undefined
      ) {
        return c.json(settingsBody(c.env, stored), 200);
      }
      const merged: SignerCheckChoice = {
        emailCode: body.emailCode ?? stored.emailCode,
        textCode: body.textCode ?? stored.textCode,
        identityCheck: body.identityCheck ?? stored.identityCheck,
        startWith: body.startWith ?? stored.startWith,
      };
      const idempotency = requireChokepointIdempotency(c);
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
                writeFirmSettingStatement(
                  firm.firmDatabase,
                  signerCheckChoiceDefinition,
                  merged,
                  timestamp,
                ),
                insertAuditLogStatement(firm.firmDatabase, {
                  id: newIdentifier("auditLog"),
                  event: "firm.signing_settings_updated",
                  actorUserId,
                  subjectId: null,
                  metadata: body,
                  now: timestamp,
                }),
              ],
              outboxMessages: [],
            },
            responseCode: 200,
            responseBody: canonicalJsonStringify(settingsBody(c.env, merged)),
          };
        },
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      const after = await readFirmSetting(firm.firmDatabase, signerCheckChoiceDefinition);
      return c.json(settingsBody(c.env, after), 200);
    },
  );
}
