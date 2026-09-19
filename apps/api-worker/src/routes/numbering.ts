import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import {
  readActiveScheme,
  setActiveNumberingScheme,
} from "@magna-carta/matters/numbering/scheme-service";
import {
  deriveScopeKey,
  renderMatterNumber,
  NumberingRenderError,
} from "@magna-carta/matters/numbering/render";
import {
  numberingSchemeSchema,
  URL_SAFE_PATTERN,
  type NumberSegment,
} from "@magna-carta/matters/numbering/segments";
import { sequenceOf } from "@magna-carta/matters/numbering/sequences";
import { ZodError } from "zod";
import type { Bindings } from "../bindings.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { idempotencyKeyHeader } from "../contracts/common.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import {
  problemResponseForIdempotencyConflict,
  storedResponseBody,
} from "../idempotency-conflict-problems.ts";

// The per-firm numbering-scheme surface: read the active scheme, replace it (one active scheme per
// firm PER PURPOSE — the write path enforces it), and preview a candidate scheme against a sample
// context without touching a counter. A firm numbers two things and shapes them separately: its
// matter numbers, and the tentative numbers its consultations carry. The matters package owns the
// segment model, the renderer, and the "exactly one counter" validation; these routes are the HTTP
// edge over them.

// The segment contract, mirroring @magna-carta/matters NumberSegment for a precise OpenAPI document.
// The cross-field "exactly one counter" rule lives in the matters package's numberingSchemeSchema (one
// home) — the write path re-validates there, so a 0/2-counter body that passes this per-segment schema
// is refused by the service and surfaced as a 422.
const optionalScoping = z.boolean().optional();
const NumberSegmentSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("literal"), text: z.string().regex(URL_SAFE_PATTERN) }),
    z.object({
      kind: z.literal("counter"),
      padWidth: z.number().int().positive(),
      start: z.number().int().positive().optional(),
    }),
    z.object({
      kind: z.literal("year"),
      digits: z.union([z.literal(2), z.literal(4)]),
      scoping: optionalScoping,
    }),
    z.object({ kind: z.literal("date_opened"), scoping: optionalScoping }),
    z.object({ kind: z.literal("location_code"), scoping: optionalScoping }),
    z.object({ kind: z.literal("matter_type_code"), scoping: optionalScoping }),
    z.object({ kind: z.literal("client_code"), scoping: optionalScoping }),
    z.object({ kind: z.literal("staff_initials"), scoping: optionalScoping }),
    z.object({ kind: z.literal("client_name"), scoping: optionalScoping }),
  ])
  .openapi("NumberSegment");

// Which of the firm's three sequences a request is about. Absent means the matter number: the
// surface predates the other two, and a caller that says nothing means what it always meant.
const purposeField = z.enum(["matter", "consultation", "intake"]).default("matter");

const SchemeBody = z
  .object({ segments: z.array(NumberSegmentSchema), purpose: purposeField })
  .openapi("NumberingScheme");

// The sample context the preview renders against — plain strings the live-preview UI supplies for the
// scoping/value segments. A scoping segment with no value here renders as a refusal (mirrors a real
// matter with no Location and no firm default).
const PreviewRequest = z
  .object({
    segments: z.array(NumberSegmentSchema),
    counterValue: z.number().int().positive().default(1),
    context: z
      .object({
        openedDate: z.string().regex(CIVIL_DATE_PATTERN).optional(),
        locationCode: z.string().optional(),
        matterTypeCode: z.string().optional(),
        clientCode: z.string().optional(),
        staffInitials: z.string().optional(),
        clientName: z.string().optional(),
      })
      .optional(),
  })
  .openapi("NumberingPreviewRequest");

const PreviewResponse = z
  .object({ number: z.string(), scopeKey: z.string() })
  .openapi("NumberingPreviewResponse");

const GetSchemeResponse = z
  .object({
    segments: z.array(NumberSegmentSchema).nullable(),
    purpose: z.enum(["matter", "consultation"]),
    // True when the firm has configured nothing and the segments above are the built-in default that
    // is actually rendering numbers today — which the consultation and intake sequences have and
    // the matter sequence does not. A matter sequence with nothing configured returns null segments
    // and false: nothing is in force, and a draw refuses rather than inventing a shape for a number
    // that is then frozen.
    usingDefault: z.boolean(),
  })
  .openapi("NumberingSchemeResponse");

const PERMISSION = "matters:manageNumbering" as const;

export const getNumberingSchemeMeta: RouteMeta = {
  operationId: "numbering.get",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const getNumberingSchemeRoute = defineOpenAPIRoute(getNumberingSchemeMeta, {
  method: "get",
  path: "/api/v1/numbering-scheme",
  description:
    "Returns the firm's active numbering scheme for one purpose (the ordered segment template): " +
    "'matter' for matter numbers, 'consultation' for the tentative numbers consultations carry, " +
    "'intake' for the numbers enquiries wear from the moment they are written down. Returns null " +
    "segments when none is configured and no default applies; usingDefault marks a built-in " +
    "sequence that renders until the firm sets its own.",
  request: { query: z.object({ purpose: purposeField }) },
  responses: {
    200: {
      description: "The active scheme's segments, or null",
      content: { "application/json": { schema: GetSchemeResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks matters:manageNumbering",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The firm is unreachable or the member is deactivated",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export const setNumberingSchemeMeta: RouteMeta = {
  operationId: "numbering.set",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "matter",
  audited: true,
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "default",
};

export const setNumberingSchemeRoute = defineOpenAPIRoute(setNumberingSchemeMeta, {
  method: "put",
  path: "/api/v1/numbering-scheme",
  description:
    "Replaces the firm's active numbering scheme for one purpose (matter numbers, or the " +
    "consultation sequence). The prior scheme of that purpose is retained but " +
    "deactivated (numbers already drawn are frozen — a scheme change affects only later matters). " +
    "Rejects a scheme without exactly one counter segment.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: SchemeBody } }, required: true },
  },
  responses: {
    200: {
      description: "The scheme was set; the validated segments are echoed",
      content: { "application/json": { schema: SchemeBody } },
    },
    400: {
      description: "Missing Idempotency-Key (this operation requires one)",
      content: { "application/problem+json": { schema: Problem } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks matters:manageNumbering",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The firm is unreachable or the member is deactivated",
      content: { "application/problem+json": { schema: Problem } },
    },
    409: {
      description: "A request with this Idempotency-Key is still in progress",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description:
        "The scheme is invalid (not exactly one counter), or the Idempotency-Key was reused",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export const previewNumberingSchemeMeta: RouteMeta = {
  operationId: "numbering.preview",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "matter",
  // A POST that mutates nothing — it renders a candidate scheme against a sample context for the
  // settings live preview. No write, no counter touch, so no audit row (auditing every keystroke of
  // the live preview would flood audit_log). Allow-listed in the conformance audited-mutating gate.
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const previewNumberingSchemeRoute = defineOpenAPIRoute(previewNumberingSchemeMeta, {
  method: "post",
  path: "/api/v1/numbering-scheme/preview",
  description:
    "Renders a candidate numbering scheme against a sample context and counter value, returning the " +
    "example number and its derived counter scope key. Pure: it writes nothing and never touches a " +
    "counter.",
  request: {
    body: { content: { "application/json": { schema: PreviewRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The rendered example number and its scope key",
      content: { "application/json": { schema: PreviewResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks matters:manageNumbering",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The firm is unreachable or the member is deactivated",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description:
        "The scheme is invalid, or a scoping/value segment has no value in the sample context",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

type NumberingApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerNumberingRoutes(app: NumberingApp, chokepoint: Chokepoint): void {
  app.openapi(
    {
      ...getNumberingSchemeRoute,
      middleware: chokepointMiddleware(chokepoint, getNumberingSchemeRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { purpose } = c.req.valid("query");
      const configured = (await readActiveScheme(firm.firmDatabase, purpose)) ?? null;
      // A sequence that has a built-in default falls back to it, so the screen shows what is
      // actually rendering rather than an empty box beside numbers people can already see. Which
      // sequences those are is the sequence table's answer, not a branch repeated here.
      const fallback = sequenceOf(purpose).fallbackScheme;
      const usingDefault = configured === null && fallback !== null;
      const segments = usingDefault ? fallback : configured;
      return c.json({ segments, purpose, usingDefault } as z.infer<typeof GetSchemeResponse>, 200);
    },
  );

  app.openapi(
    {
      ...setNumberingSchemeRoute,
      middleware: chokepointMiddleware(chokepoint, setNumberingSchemeRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      const now = () => new Date().toISOString();

      let result;
      try {
        result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          now,
          effect: () => {
            const { effect } = setActiveNumberingScheme(
              firm.firmDatabase,
              request.segments as NumberSegment[],
              { clock: { now }, actorUserId: userId },
              request.purpose,
            );
            return Promise.resolve({
              write: effect,
              responseCode: 200,
              responseBody: canonicalJsonStringify({
                segments: request.segments,
                purpose: request.purpose,
              }),
            });
          },
        });
      } catch (caught) {
        if (caught instanceof ZodError) {
          return problemJson(c, {
            type: "validation",
            title: "Invalid numbering scheme",
            status: 422,
            detail: "A numbering scheme needs exactly one counter segment.",
          });
        }
        throw caught;
      }

      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      const body = JSON.parse(storedResponseBody(result)) as z.infer<typeof SchemeBody>;
      return c.json(body, 200);
    },
  );

  app.openapi(
    {
      ...previewNumberingSchemeRoute,
      middleware: chokepointMiddleware(chokepoint, previewNumberingSchemeRoute),
    },
    (c) => {
      const request = c.req.valid("json");
      let segments: readonly NumberSegment[];
      try {
        segments = numberingSchemeSchema.parse(request.segments);
      } catch (caught) {
        if (caught instanceof ZodError) {
          return problemJson(c, {
            type: "validation",
            title: "Invalid numbering scheme",
            status: 422,
            detail: "A numbering scheme needs exactly one counter segment.",
          });
        }
        throw caught;
      }
      const context = {
        openedDate: request.context?.openedDate ?? "2026-01-01",
        locationCode: request.context?.locationCode,
        matterTypeCode: request.context?.matterTypeCode,
        clientCode: request.context?.clientCode,
        staffInitials: request.context?.staffInitials,
        clientName: request.context?.clientName,
      };
      try {
        const number = renderMatterNumber(segments, context, request.counterValue);
        const scopeKey = deriveScopeKey(segments, context);
        return c.json({ number, scopeKey }, 200);
      } catch (caught) {
        if (caught instanceof NumberingRenderError) {
          return problemJson(c, {
            type: "validation",
            title: "Cannot render the scheme",
            status: 422,
            detail: caught.message,
          });
        }
        throw caught;
      }
    },
  );
}
