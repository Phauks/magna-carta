import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { readInspectableSizeCap } from "@magna-carta/file-manager/upload-policy";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { resolveEmailEnginePort } from "../emails/email-engine-binding.ts";
import { emailEngineProblem } from "../emails/email-engine-problem.ts";

// The parse itself runs in apps/email-worker, the entrance Cloudflare Email Routing already
// delivers to, behind the port in ../emails/. This route holds no engine and no WebAssembly build.

export const emailInspectMeta: RouteMeta = {
  operationId: "emailInspector.inspect",
  surface: "app",
  authenticated: true,
  permission: "tools:emailInspector",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "expensive",
};

// A network address as parsed from a header or MAPI property — either half may be absent when the
// source carried only one.
const AddressSchema = z.object({
  displayName: z.string().nullable(),
  address: z.string().nullable(),
});

// Where a part's bytes live differs by container: a contiguous span of the original input for
// .eml/mbox parts, or a named compound-file stream for .msg parts. A discriminated union rather
// than a struct with optional fields, so a caller that handles one kind cannot mistake the other.
const PartLocatorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("inputRange"), start: z.number(), end: z.number() }),
  z.object({ kind: z.literal("mapiStream"), name: z.string() }),
]);

const PartDescriptorSchema = z.object({
  filename: z.string().nullable(),
  mediaType: z.string().nullable(),
  contentIdentifier: z.string().nullable(),
  disposition: z.enum(["attachment", "inline"]),
  size: z.number(),
  locator: PartLocatorSchema,
  isEmbeddedMessage: z.boolean(),
});

// Mirrors the engine's ParsedMessage field-for-field: the engine describes a message
// without materialising any attachment bytes, so this is metadata and body text only.
const ParsedMessageSchema = z.object({
  // A message identifier remembers where it came from: a .msg file carries RFC 5322 headers only
  // when they survived export, so an identifier synthesized from MAPI properties is not the same
  // bytes another recipient's .eml copy carries — provenance must never be collapsed away.
  messageIdentifier: z.object({
    value: z.string().nullable(),
    provenance: z.enum(["header", "mapi", "absent"]),
  }),
  inReplyTo: z.string().nullable(),
  references: z.array(z.string()),
  subject: z.string().nullable(),
  dateRaw: z.string().nullable(),
  from: z.array(AddressSchema),
  to: z.array(AddressSchema),
  cc: z.array(AddressSchema),
  bcc: z.array(AddressSchema),
  rawHeaders: z.array(z.object({ name: z.string(), value: z.string() })),
  textBodies: z.array(z.string()),
  htmlBodies: z.array(z.string()),
  rtfBody: z.string().nullable(),
  parts: z.array(PartDescriptorSchema),
  // Authenticity evidence, captured verbatim with no verdict attached.
  integrity: z.object({
    dkimSignatures: z.array(z.string()),
    authenticationResults: z.array(z.string()),
    receivedChain: z.array(z.string()),
  }),
  sourceFormat: z.enum(["eml", "msg", "mboxMember"]),
  referencesRemoteContent: z.boolean(),
});

const inspectRoute = defineOpenAPIRoute(emailInspectMeta, {
  method: "post",
  path: "/api/v1/email/inspect",
  description:
    "Parse an uploaded email file (.eml or .msg) and return its headers, participants, subject, " +
    "message and reply identifiers, body text, described attachments, and authenticity evidence " +
    "(DKIM signatures, authentication results, and the received chain) captured verbatim with no " +
    "verdict. Nothing is stored. Where no parse engine is wired, or the engine is wired but " +
    "unreachable, the answer is a 503 — an engine that cannot read the file says nothing about it.",
  request: {
    body: { content: { "application/octet-stream": { schema: z.any() } }, required: true },
  },
  responses: {
    200: {
      description: "Parsed message",
      content: { "application/json": { schema: ParsedMessageSchema } },
    },
    400: {
      description: "Empty request body",
      content: { "application/problem+json": { schema: Problem } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Missing tools:emailInspector",
      content: { "application/problem+json": { schema: Problem } },
    },
    413: {
      description: "File exceeds the inspectable-size cap",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description:
        "The bytes could not be read as an email, or are not a format this tool supports",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
    503: {
      description:
        "No email parse engine is wired, or it is wired but unreachable, so the file was not read",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerEmailInspectorRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...inspectRoute, middleware: chokepointMiddleware(chokepoint, inspectRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const body = c.req.raw.body;
      if (body === null) {
        return problemJson(c, {
          type: "validation",
          title: "Empty body",
          status: 400,
          detail: "Provide the email file bytes as the request body.",
        });
      }
      const sizeBytes = Number(c.req.header("content-length") ?? "0");
      const cap = await readInspectableSizeCap(firm.firmDatabase);
      if (sizeBytes > cap) {
        await body.cancel();
        return problemJson(c, {
          type: "upload-not-allowed",
          title: "File too large to inspect inline",
          status: 413,
          detail: `The file exceeds this firm's inspectable-size cap (${cap} bytes).`,
        });
      }

      // Three outcomes and only the first is about this file: the parse, a stable refusal code
      // (413 or 422), or an engine that is absent or cannot answer (503 — never an Error ID for an
      // engine that is simply not there). The one mapping is shared with any other request-path
      // caller of the engine; this route must not grow its own.
      try {
        const bytes = new Uint8Array(await c.req.arrayBuffer());
        return c.json(await resolveEmailEnginePort(c.env).parseMessage(bytes), 200);
      } catch (thrown) {
        const refusal = emailEngineProblem(c, thrown);
        if (refusal !== null) return refusal;
        throw thrown;
      }
    },
  );
}
