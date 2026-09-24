import { CIVIL_DATE_PATTERN, todayInUtc } from "@magna-carta/civil-time/civil-date";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import {
  NUMBERING_PURPOSES,
  type SchemeNumberingPurpose,
} from "@magna-carta/sequence-numbering/purposes";
import {
  deriveScopeKey,
  renderNumber,
  NumberingRenderError,
  type RenderContext,
} from "@magna-carta/sequence-numbering/render";
import {
  readSchemeInForce,
  schemeSchemaFor,
  setActiveNumberingScheme,
} from "@magna-carta/sequence-numbering/scheme-service";
import {
  startValueOf,
  URL_SAFE_PATTERN,
  type NumberSegment,
} from "@magna-carta/sequence-numbering/segments";
import { ZodError } from "zod";
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
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import {
  problemResponseForIdempotencyConflict,
  storedResponseBody,
} from "../../idempotency-conflict-problems.ts";

// The per-firm numbering surface: every number the firm issues, listed from one register; the
// active scheme for one purpose, read and replaced (one active scheme per firm PER PURPOSE — the
// write path enforces it); and a candidate scheme previewed against a sample record without
// touching a counter. The sequence-numbering package owns the register, the segment model, the
// renderer, and the "exactly one counter" validation; these routes are the HTTP edge over them.

// The segment contract, mirroring @magna-carta/sequence-numbering's NumberSegment for a precise
// OpenAPI document. The cross-field rules — exactly one counter, and only the parts a purpose may
// use — live in the package's scheme schema (one home); the write path re-validates there, so a
// body that passes this per-segment schema can still be refused by the service as a 422.
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

const SegmentKindSchema = z.enum([
  "literal",
  "counter",
  "year",
  "date_opened",
  "location_code",
  "matter_type_code",
  "client_code",
  "staff_initials",
  "client_name",
]);

// Which of the firm's scheme-shaped sequences a request is about. Absent means the matter number:
// the surface predates the others, and a caller that says nothing means what it always meant. The
// tuple is spelled here for the OpenAPI document; the register is what it has to agree with, and
// the assignment below fails to compile if the two ever drift.
const SCHEME_PURPOSES = [
  "matter",
  "consultation",
  "intake",
  "conflicts_check",
  "custody_packet",
] as const satisfies readonly SchemeNumberingPurpose[];
const registerAgreesWithContract: readonly (typeof SCHEME_PURPOSES)[number][] =
  [] as SchemeNumberingPurpose[];
void registerAgreesWithContract;
const purposeField = z.enum(SCHEME_PURPOSES).default("matter");

const SchemeBody = z
  .object({ segments: z.array(NumberSegmentSchema), purpose: purposeField })
  .openapi("NumberingScheme");

// The sample record the preview renders against — plain strings the live-preview UI supplies for the
// scoping/value segments. A scoping segment with no value here renders as a refusal (mirrors a real
// matter with no Location and no firm default).
const SampleContextSchema = z
  .object({
    openedDate: z.string().regex(CIVIL_DATE_PATTERN),
    locationCode: z.string(),
    matterTypeCode: z.string(),
    clientCode: z.string(),
    staffInitials: z.string(),
    clientName: z.string(),
  })
  .openapi("NumberingSampleContext");

const PreviewRequest = z
  .object({
    segments: z.array(NumberSegmentSchema),
    // Named so the preview refuses a part this sequence cannot use, where the editor is looking,
    // rather than at the save. Absent means the matter sequence, which may use every part.
    purpose: purposeField,
    counterValue: z.number().int().positive().default(1),
    context: SampleContextSchema.partial().optional(),
  })
  .openapi("NumberingPreviewRequest");

const PreviewResponse = z
  .object({ number: z.string(), scopeKey: z.string() })
  .openapi("NumberingPreviewResponse");

const GetSchemeResponse = z
  .object({
    segments: z.array(NumberSegmentSchema).nullable(),
    purpose: z.enum(SCHEME_PURPOSES),
    // True when the firm has configured nothing and the segments above are the built-in default that
    // is actually rendering numbers today — which every sequence but the matter sequence has. A
    // matter sequence with nothing configured returns null segments and false: nothing is in force,
    // and a draw refuses rather than inventing a shape for a number that is then frozen.
    usingDefault: z.boolean(),
  })
  .openapi("NumberingSchemeResponse");

// One row of the register as the settings screen lists it: what the sequence is, when its number
// is drawn, and either the scheme in force (with the parts it may use) or the fixed shape and why.
const ListedPurposeSchema = z
  .object({
    purpose: z.enum([
      "matter",
      "consultation",
      "intake",
      "conflicts_check",
      "custody_packet",
      "invoice",
      "time_entry",
      "communication",
    ]),
    title: z.string(),
    label: z.string(),
    subject: z.string(),
    subjects: z.string(),
    drawnWhen: z.string(),
    formulation: z.enum(["scheme", "fixed"]),
    // Scheme-shaped purposes: the parts a scheme may use, what is in force (null where nothing is
    // and no default applies), and whether that is the built-in default.
    segmentKinds: z.array(SegmentKindSchema).nullable(),
    segments: z.array(NumberSegmentSchema).nullable(),
    usingDefault: z.boolean().nullable(),
    // Fixed purposes: the shape and the reason. Null for a scheme-shaped purpose.
    fixedShape: z.string().nullable(),
    // What the first number of the sample would render as under what is in force — the scheme
    // rendered against the sample below, or the fixed shape's own example. Null where nothing is
    // in force.
    example: z.string().nullable(),
  })
  .openapi("NumberingListedPurpose");

const ListSchemesResponse = z
  .object({
    purposes: z.array(ListedPurposeSchema),
    // The sample record every example above was rendered against, so a screen previewing an edit
    // renders against the same one and the two never disagree.
    sample: SampleContextSchema,
  })
  .openapi("NumberingSchemesResponse");

// The sample every example renders against: today's UTC date, so the year is the reader's, and codes
// that read as samples rather than as the firm's own.
function sampleContext(): z.infer<typeof SampleContextSchema> {
  return {
    openedDate: todayInUtc(),
    locationCode: "RNO",
    matterTypeCode: "LIT",
    clientCode: "ASH",
    staffInitials: "EV",
    clientName: "Ashcombe Mercantile",
  };
}

const PERMISSION = "matters:manageNumbering" as const;
// Reading the register is every member's: how the firm's numbers are shaped is a fact they read off
// every record, so the two reads ride a key seeded to every default role (owner ruling, 2026-09-18).
const VIEW_PERMISSION = "matters:viewNumbering" as const;

export const listNumberingSchemesMeta: RouteMeta = {
  operationId: "numbering.list",
  surface: "app",
  authenticated: true,
  permission: VIEW_PERMISSION,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const listNumberingSchemesRoute = defineOpenAPIRoute(listNumberingSchemesMeta, {
  method: "get",
  path: "/api/v1/numbering-schemes",
  description:
    "Lists every number the firm issues, from the one numbering register: matter, consultation, " +
    "intake, conflicts check and custody numbers, whose shape the firm writes as a scheme, and " +
    "invoice, time entry and call numbers, whose shape is fixed. Each scheme-shaped purpose " +
    "carries the parts it may use, what is in force (the firm's scheme or the built-in default), " +
    "and an example rendered against the sample record returned beside the list.",
  responses: {
    200: {
      description: "Every purpose on the register, and the sample the examples render against",
      content: { "application/json": { schema: ListSchemesResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks matters:viewNumbering",
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

export const getNumberingSchemeMeta: RouteMeta = {
  operationId: "numbering.get",
  surface: "app",
  authenticated: true,
  permission: VIEW_PERMISSION,
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
    "'intake' for the numbers enquiries wear from the moment they are written down, " +
    "'conflicts_check' for conflicts check numbers, 'custody_packet' for custody numbers. Returns " +
    "null segments when none is configured and no default applies; usingDefault marks a built-in " +
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
      description: "The session member lacks matters:viewNumbering",
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
    "Replaces the firm's active numbering scheme for one purpose. The prior scheme of that " +
    "purpose is retained but deactivated (numbers already drawn are frozen — a scheme change " +
    "affects only records numbered after it). Rejects a scheme without exactly one counter " +
    "segment, or one using a part the purpose cannot render (a conflicts check has no client code).",
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
        "The scheme is invalid (not exactly one counter, or a part this purpose cannot use), or " +
        "the Idempotency-Key was reused",
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
    "counter. Refuses a part the named purpose cannot use.",
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

// The one sentence a refused scheme gets. The zod issue carries which rule failed; a person reads
// the rule, not the path.
function invalidSchemeDetail(error: ZodError): string {
  const message = error.issues[0]?.message;
  return message === undefined
    ? "A numbering scheme needs exactly one counter segment."
    : message.charAt(0).toUpperCase() + message.slice(1) + ".";
}

// An example is rendered where the sample has every value the scheme asks for; a scheme cannot
// fail to render against the full sample, but the renderer's refusal is still translated rather
// than trusted, so a listing never throws over one purpose's scheme.
function exampleOf(segments: readonly NumberSegment[], sample: RenderContext): string | null {
  try {
    return renderNumber(segments, sample, startValueOf(segments));
  } catch (caught) {
    if (caught instanceof NumberingRenderError) return null;
    throw caught;
  }
}

export function registerNumberingRoutes(app: NumberingApp, chokepoint: Chokepoint): void {
  app.openapi(
    {
      ...listNumberingSchemesRoute,
      middleware: chokepointMiddleware(chokepoint, listNumberingSchemesRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const sample = sampleContext();
      const purposes: z.infer<typeof ListedPurposeSchema>[] = [];
      for (const definition of NUMBERING_PURPOSES) {
        const common = {
          purpose: definition.purpose,
          title: definition.title,
          label: definition.label,
          subject: definition.subject,
          subjects: definition.subjects,
          drawnWhen: definition.drawnWhen,
        };
        if (definition.formulation === "fixed") {
          purposes.push({
            ...common,
            formulation: "fixed",
            segmentKinds: null,
            segments: null,
            usingDefault: null,
            fixedShape: definition.fixedShape,
            example: definition.example,
          });
          continue;
        }
        const inForce = await readSchemeInForce(firm.firmDatabase, definition.purpose);
        purposes.push({
          ...common,
          formulation: "scheme",
          segmentKinds: [...definition.segmentKinds],
          segments: inForce === undefined ? null : [...inForce.segments],
          usingDefault: inForce === undefined ? false : inForce.usingDefault,
          fixedShape: null,
          example: inForce === undefined ? null : exampleOf(inForce.segments, sample),
        });
      }
      return c.json({ purposes, sample } as z.infer<typeof ListSchemesResponse>, 200);
    },
  );

  app.openapi(
    {
      ...getNumberingSchemeRoute,
      middleware: chokepointMiddleware(chokepoint, getNumberingSchemeRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { purpose } = c.req.valid("query");
      // A sequence that has a built-in default falls back to it, so the screen shows what is
      // actually rendering rather than an empty box beside numbers people can already see. Which
      // sequences those are is the register's answer, not a branch repeated here.
      const inForce = await readSchemeInForce(firm.firmDatabase, purpose);
      return c.json(
        {
          segments: inForce === undefined ? null : [...inForce.segments],
          purpose,
          usingDefault: inForce === undefined ? false : inForce.usingDefault,
        } as z.infer<typeof GetSchemeResponse>,
        200,
      );
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
            detail: invalidSchemeDetail(caught),
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
        segments = schemeSchemaFor(request.purpose).parse(request.segments);
      } catch (caught) {
        if (caught instanceof ZodError) {
          return problemJson(c, {
            type: "validation",
            title: "Invalid numbering scheme",
            status: 422,
            detail: invalidSchemeDetail(caught),
          });
        }
        throw caught;
      }
      const context: RenderContext = {
        openedDate: request.context?.openedDate ?? "2026-01-01",
        locationCode: request.context?.locationCode,
        matterTypeCode: request.context?.matterTypeCode,
        clientCode: request.context?.clientCode,
        staffInitials: request.context?.staffInitials,
        clientName: request.context?.clientName,
      };
      try {
        const number = renderNumber(segments, context, request.counterValue);
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
