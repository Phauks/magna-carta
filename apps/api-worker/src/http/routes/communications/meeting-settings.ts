import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import {
  readFirmSetting,
  writeFirmSettingStatement,
} from "@magna-carta/data-access/setting-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { aiProcessingEligibilityDefinition } from "@magna-carta/inference/settings";
import {
  captionsEnabledDefinition,
  RECORDED_TRACK_CEILING_MAXIMUM,
  recordedTrackCeilingDefinition,
  recordingEnabledDefinition,
  summariesEnabledDefinition,
} from "@magna-carta/meetings/settings";
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
import { recordingDeploymentConfigured } from "./meetings.ts";

// THE FIRM'S MEETING SETTINGS — the one place a firm decides whether its meetings may be recorded,
// captioned and summarized, and how many people one recording hears at once.
//
// The four settings are declared in packages/meetings/src/settings.ts and every one defaults OFF
// (the ceiling defaults to its maximum), because each sends a privileged conversation somewhere it
// did not go before. They had readers — the recording start route, the summary consumer, the
// recorder — and no writer, so every firm's recording answered `meeting-recording-not-configured`
// and every summary was refused `disabled`. This route is the sole writer.
//
// TWO FACTS RIDE BESIDE THE SWITCHES, READ AND NEVER WRITTEN HERE, because the switches alone would
// let a firm believe something that is not true:
//
//   - `recordingServiceConfigured`: whether THIS DEPLOYMENT can record at all — media routing, the
//     sink's signing key, the recorder binding and an origin the routing service can dial back. A
//     firm can switch recording on and still have the start route answer 503 until the platform
//     sets those up. It is a read of bindings, so it costs nothing to carry on every answer.
//   - `aiProcessingEligible`: the firm's third-party AI processing gate. A summary needs BOTH that
//     gate and `meetings.summariesEnabled`, so a firm that switched summaries on with the gate shut
//     has switched on nothing. The gate is written only by the AI settings route
//     (firm-ai-settings.ts) and is reported here, never written.
//
// The ceiling's maximum is reported too, as a number rather than left for a client to know: it is
// derived from what one recorder can hold in memory, and the screen states it from this answer.

const PERMISSION = "meetings:manageSettings" as const;

const FirmMeetingSettingsResponse = z
  .object({
    // Whether a meeting on a matter may be recorded. A recording announces itself to everyone in
    // the meeting and its audio is added to the matter.
    recordingEnabled: z.boolean(),
    // Whether live captions may run during a meeting.
    captionsEnabled: z.boolean(),
    // Whether a recorded meeting's transcript is summarized, with its action items.
    summariesEnabled: z.boolean(),
    // The most people one recording hears at once.
    recordedTrackCeiling: z.number().int(),
    // The highest the ceiling may be set: what one recorder can hold in memory.
    recordedTrackCeilingMaximum: z.number().int(),
    // Whether this deployment can record at all. False, a recording cannot start whatever the
    // firm's switch says.
    recordingServiceConfigured: z.boolean(),
    // Whether the firm's third-party AI processing is on. A summary needs it as well.
    aiProcessingEligible: z.boolean(),
  })
  .openapi("FirmMeetingSettingsResponse");

const PatchFirmMeetingSettingsRequest = z
  .object({
    // Sparse: a field absent is unchanged, and an empty patch writes nothing and audits nothing.
    recordingEnabled: z.boolean().optional(),
    captionsEnabled: z.boolean().optional(),
    summariesEnabled: z.boolean().optional(),
    // The same bounds the setting definition enforces at the write path, declared here so a bad
    // value is a 422 against the contract rather than a throw inside the effect.
    recordedTrackCeiling: z.number().int().min(1).max(RECORDED_TRACK_CEILING_MAXIMUM).optional(),
  })
  .openapi("PatchFirmMeetingSettingsRequest");

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
    description: "The session member lacks meetings:manageSettings",
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
  operationId: "firmMeetingSettings.get",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const patchMeta: RouteMeta = {
  operationId: "firmMeetingSettings.update",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  // Audited: this row is the record of who decided that the firm's meetings could be recorded,
  // captioned or summarized, and when. The metadata is the patch itself — three booleans and an
  // integer, nothing a person typed.
  audited: true,
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "default",
};

const getRoute = defineOpenAPIRoute(getMeta, {
  method: "get",
  path: "/api/v1/firm/meetings/settings",
  description:
    "Reads the firm's meeting settings: whether a meeting may be recorded, whether live captions " +
    "may run, whether a recorded meeting is summarized, and the most people one recording hears at " +
    "once, with the highest that ceiling may be set. Beside them, two facts this route never " +
    "writes: whether this deployment's recording service is configured (a recording cannot start " +
    "until it is), and whether the firm's third-party AI processing is on (a summary needs it as " +
    "well). Every switch is off until a firm turns it on.",
  responses: {
    200: {
      description: "The firm's meeting settings",
      content: { "application/json": { schema: FirmMeetingSettingsResponse } },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    429: errorResponses[429],
  },
});

const patchRoute = defineOpenAPIRoute(patchMeta, {
  method: "patch",
  path: "/api/v1/firm/meetings/settings",
  description:
    "Updates the firm's meeting settings. Sparse: an absent field is left alone, and an empty patch " +
    "changes nothing and records nothing. The recorded-track ceiling is a whole number from 1 to " +
    "the maximum the read reports. Returns the settings after the write.",
  request: {
    headers: idempotencyKeyHeader,
    body: {
      required: true,
      content: { "application/json": { schema: PatchFirmMeetingSettingsRequest } },
    },
  },
  responses: {
    200: {
      description: "The firm's meeting settings after the write",
      content: { "application/json": { schema: FirmMeetingSettingsResponse } },
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

// The write's clock: the instant every statement in one save is stamped with, and the idempotency
// record's.
function now(): string {
  return new Date().toISOString();
}

type MeetingSettingsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;
type MeetingSettingsBody = z.infer<typeof FirmMeetingSettingsResponse>;
type FirmDatabase = Parameters<typeof readFirmSetting>[0];

async function readMeetingSettingsBody(
  env: Bindings,
  database: FirmDatabase,
): Promise<MeetingSettingsBody> {
  const [
    recordingEnabled,
    captionsEnabled,
    summariesEnabled,
    recordedTrackCeiling,
    aiProcessingEligible,
  ] = await Promise.all([
    readFirmSetting(database, recordingEnabledDefinition),
    readFirmSetting(database, captionsEnabledDefinition),
    readFirmSetting(database, summariesEnabledDefinition),
    readFirmSetting(database, recordedTrackCeilingDefinition),
    readFirmSetting(database, aiProcessingEligibilityDefinition),
  ]);
  return {
    recordingEnabled,
    captionsEnabled,
    summariesEnabled,
    recordedTrackCeiling,
    recordedTrackCeilingMaximum: RECORDED_TRACK_CEILING_MAXIMUM,
    recordingServiceConfigured: recordingDeploymentConfigured(env),
    aiProcessingEligible,
  };
}

export function registerMeetingSettingsRoutes(
  app: MeetingSettingsApp,
  chokepoint: Chokepoint,
): void {
  // GET /api/v1/firm/meetings/settings
  app.openapi(
    { ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      return c.json(await readMeetingSettingsBody(c.env, firm.firmDatabase), 200);
    },
  );

  // PATCH /api/v1/firm/meetings/settings
  app.openapi(
    { ...patchRoute, middleware: chokepointMiddleware(chokepoint, patchRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const actorUserId = requireChokepointUserId(c);
      const body = c.req.valid("json");
      const { recordingEnabled, captionsEnabled, summariesEnabled, recordedTrackCeiling } = body;
      if (
        recordingEnabled === undefined &&
        captionsEnabled === undefined &&
        summariesEnabled === undefined &&
        recordedTrackCeiling === undefined
      ) {
        // An empty patch changes nothing and must not add an audit row: a redelivered no-op would
        // otherwise put a decision in the log that nobody made.
        return c.json(await readMeetingSettingsBody(c.env, firm.firmDatabase), 200);
      }

      const idempotency = requireChokepointIdempotency(c);
      const stored = await readMeetingSettingsBody(c.env, firm.firmDatabase);
      const merged: MeetingSettingsBody = {
        ...stored,
        recordingEnabled: recordingEnabled ?? stored.recordingEnabled,
        captionsEnabled: captionsEnabled ?? stored.captionsEnabled,
        summariesEnabled: summariesEnabled ?? stored.summariesEnabled,
        recordedTrackCeiling: recordedTrackCeiling ?? stored.recordedTrackCeiling,
      };

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
                ...(recordingEnabled === undefined
                  ? []
                  : [
                      writeFirmSettingStatement(
                        firm.firmDatabase,
                        recordingEnabledDefinition,
                        recordingEnabled,
                        timestamp,
                      ),
                    ]),
                ...(captionsEnabled === undefined
                  ? []
                  : [
                      writeFirmSettingStatement(
                        firm.firmDatabase,
                        captionsEnabledDefinition,
                        captionsEnabled,
                        timestamp,
                      ),
                    ]),
                ...(summariesEnabled === undefined
                  ? []
                  : [
                      writeFirmSettingStatement(
                        firm.firmDatabase,
                        summariesEnabledDefinition,
                        summariesEnabled,
                        timestamp,
                      ),
                    ]),
                ...(recordedTrackCeiling === undefined
                  ? []
                  : [
                      writeFirmSettingStatement(
                        firm.firmDatabase,
                        recordedTrackCeilingDefinition,
                        recordedTrackCeiling,
                        timestamp,
                      ),
                    ]),
                insertAuditLogStatement(firm.firmDatabase, {
                  id: newIdentifier("auditLog"),
                  event: "firm.meeting_settings_updated",
                  actorUserId,
                  subjectId: null,
                  // The patch as submitted: three booleans and an integer, nothing a person typed.
                  metadata: body,
                  now: timestamp,
                }),
              ],
              outboxMessages: [],
            },
            responseCode: 200,
            // Composed from the merged value rather than re-read: a read inside this effect would
            // not yet see its own uncommitted write.
            responseBody: canonicalJsonStringify(merged),
          };
        },
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(await readMeetingSettingsBody(c.env, firm.firmDatabase), 200);
    },
  );
}
