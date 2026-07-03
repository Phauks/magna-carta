// The conformance fitness functions. The route table is a security registry — these run structurally
// over the EMITTED document (not source text), so a route that drifts out of the posture fails CI.
//
// Each fitness function returns a list of human-readable violations; a clean contract returns []. Every
// rule is proven two ways: the committed contract satisfies it, AND a deliberately-misconfigured route
// (constructed in-test, never committed) is caught — the machinery, not just today's happy routes.
import { OpenAPIHono, z } from "@hono/zod-openapi";
import { PERMISSIONS } from "@magna-carta/access-control/registry";
import { describe, expect, it } from "vitest";
import { buildOpenAPIDocument, createApp, emitOpenAPIDocument } from "../src/app.ts";
import {
  defineOpenAPIRoute,
  isMutatingMethod,
  MUTATING_METHODS,
  type RouteMeta,
} from "../src/contracts/route-meta.ts";

type Operation = Record<string, unknown>;
const OPERATION_ID_SHAPE = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;

// Subsystem keywords that designate a money/trust/payment/outbound-comms namespace. The safety net
// below asserts every committed route whose namespace is one of these is registered in
// MONEY_NAMESPACES — so a money route added without registering it (which would silently escape the
// idempotency-required gate) fails CI, rather than relying on each slice author's memory.
const MONEY_SUBSYSTEM_KEYWORDS = new Set([
  "trust",
  "billing",
  "payments",
  "disbursements",
  "communications",
]);

// authenticated: false is never implicit — every anonymous route is allow-listed here with the reason
// it carries no firm data behind no session. Adding an anonymous route without an entry fails the gate
// — no route is silently public.
const PUBLIC_ALLOW_LIST: Record<string, string> = {
  "health.read": "Liveness/readiness probe — platform plumbing, no firm data, no session.",
};

// POST routes that mutate nothing — a pure computation over the request body (a preview/render) — are
// exempt from the audited-mutating requirement: there is no state change to audit, and auditing a hot
// read-shaped POST (the numbering live preview, fired on every keystroke) would flood audit_log. Each
// is allow-listed by operationId with its justification, the same explicit-exemption pattern as
// PUBLIC_ALLOW_LIST. The non-null-permission requirement still binds (these are authenticated).
const NON_MUTATING_POST_ALLOW_LIST: Record<string, string> = {
  "numbering.preview":
    "Pure render of a candidate numbering scheme against a sample context — no write, no counter touch.",
  "directory.duplicateCandidates":
    "Read-shaped POST: unions the phonetic/trigram/blind-index blocking channels for a prospective entity (match facts ride the body) — no write, no decrypt.",
  "shipping.rateShipment":
    "Live rate-shop read-through to the carrier — POSTs the package to fetch ephemeral rates, persists nothing.",
  "shipping.tracking":
    "Pulls current carrier tracking and caches events (INSERT OR IGNORE dedup) — a read-shaped sync, not an auditable business mutation.",
  "customFields.previewConvert":
    "Read-shaped POST: counts how each current value would land under a kind change (the target kind rides the body) — no write, no audit.",
  "timeEntries.previewQuickAdd":
    "Read-shaped POST: parses a one-line quick-add string and returns matter candidates — no write, nothing committed.",
  "conversions.upload":
    "Pure credential mint: mints a jobId and a short-TTL presigned PUT URL — no D1 write, no firm state change, just a signed URL the client uploads to directly.",
  "conversions.submit":
    "Enqueues a conversion job through a Durable Object (no D1 write, no firm-database row): the DO + queue track the lifecycle; there is no audit_log row class that models a transient compute job.",
  "safeBrowse.post":
    "Renders a suspect URL in an isolated remote browser and returns a static snapshot — a pure read over the request body, no firm-data write; the target URL is deliberately never logged (redaction).",
  "metadata.inspect":
    "Pure computation over the uploaded bytes — reports metadata findings; nothing is stored, no firm data is written.",
  "metadata.scrub":
    "Pure computation over the uploaded bytes — returns a cleaned copy in-process; nothing is stored, no firm data is written.",
  "fileIntegrity.hash":
    "Pure computation over the streamed request body — computes five digests in one pass; nothing is stored, no firm data is written.",
  "fileType.verify":
    "Pure classification over the uploaded bytes — identifies the true content type (raw facts from the container, verdict app-side); nothing is stored, no firm data is written.",
  "aiDetection.detect":
    "Analysis POST: sends pasted text to the platform-managed detector and returns a likelihood band. The only write is one incidental ai_detection_usage meter row (telemetry — the accountability record for the egress), not an auditable firm-domain mutation; auditing every detection would flood audit_log.",
};

// Subsystems whose every route must be idempotency: required (money/trust/payment/outbound-comms).
// Empty until the trust/billing/payments/comms slices land — the assertion machinery is what ships now;
// each of those slices adds its operationId namespace here as it builds.
const MONEY_NAMESPACES = new Set<string>();

// x-mc-operationId is a string in every emitted operation; read it defensively (the value is typed
// unknown off the document record) so the fitness functions never stringify a non-string.
function operationIdOf(operation: Operation): string {
  const value = operation["x-mc-operationId"];
  return typeof value === "string" ? value : "";
}

// Yields every operation in the document with its path/method, operationId, and namespace.
function* operations(document: ReturnType<typeof buildOpenAPIDocument>) {
  const methods = ["get", ...MUTATING_METHODS];
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const method of methods) {
      const operation = (item as Record<string, Operation | undefined>)[method];
      if (operation === undefined) continue;
      const operationId = operationIdOf(operation);
      yield { path, method, operation, operationId, namespace: operationId.split(".")[0] ?? "" };
    }
  }
}

// Rule: every authenticated mutating route is audited AND names a permission; an unauthenticated
// mutating route (allow-listed public) is still audited.
function auditedMutatingViolations(document: ReturnType<typeof buildOpenAPIDocument>): string[] {
  const violations: string[] = [];
  for (const { path, method, operation } of operations(document)) {
    if (!isMutatingMethod(method)) continue;
    const label = `${method.toUpperCase()} ${path}`;
    if (
      operation["x-mc-audited"] !== true &&
      NON_MUTATING_POST_ALLOW_LIST[operationIdOf(operation)] === undefined
    ) {
      violations.push(`${label}: mutating route must be x-mc-audited: true`);
    }
    if (operation["x-mc-authenticated"] === true && operation["x-mc-permission"] == null) {
      violations.push(
        `${label}: authenticated mutating route must name a non-null x-mc-permission`,
      );
    }
  }
  return violations;
}

// The legitimate permission-namespace → x-mc-resource bindings. Permission namespace (the capability
// subsystem) and resource (the tenancy/ownership root the route operates on) are DISTINCT axes: they
// coincide for `firm`, but a capability can govern a resource rooted elsewhere — `files:*` operates on
// matter-rooted file objects, so its routes carry resource "matter". This map is the explicit binding
// the original strict-equality rule's comment anticipated would need revisiting once such a permission
// landed (slice 1·1's files/matters/locations). It stays a guard, not a suppression: each namespace
// maps to EXACTLY ONE allowed resource, so a route naming a permission from an unrelated subsystem
// still fails. A new permission subsystem adds its row here (and a genuinely multi-resource subsystem
// would widen the value to a set — revisit deliberately, never delete the check).
const RESOURCE_BY_PERMISSION_NAMESPACE: Record<string, string> = {
  firm: "firm",
  matters: "matter",
  locations: "location",
  files: "matter",
  directory: "directoryEntity",
  shipping: "firm",
  tools: "firm",
  // customFields:* governs firm-defined fields on matter/entity records; its routes carry the
  // matter resource (the nearest tenancy root — custom fields extend matter/entity records).
  customFields: "matter",
  // documents:* governs in-app editing of matter-rooted file objects (the same tenancy root files:*
  // carries), so its routes carry the matter resource.
  documents: "matter",
  // time:* governs time entries and the rate engine, all scoped to matters; the matter resource
  // is the nearest tenancy root for every time-entry mutation and read.
  time: "matter",
  // costs:* governs disbursement WIP entries, all scoped to matters; the matter resource is the
  // nearest tenancy root for every cost-entry mutation and read (mirrors the time precedent).
  costs: "matter",
  // support:* governs help-desk access grants on a firm; grants are firm-scoped (the consent
  // anchor is a firm member, the grant row lives in the control-plane firm namespace).
  support: "firm",
  // diagnostics:* is the read-only system-state surface granted only by a diagnostic support session;
  // no firm role holds it. The resource is the firm — the overview is per-firm state.
  diagnostics: "firm",
};

// Rule: every named permission exists in the registry, and its namespace binds to the route's
// x-mc-resource through RESOURCE_BY_PERMISSION_NAMESPACE (the capability subsystem governs that
// tenancy resource). An unregistered permission, an unknown namespace, or a resource that does not
// match the namespace's allowed binding is a violation.
function permissionRegistryViolations(document: ReturnType<typeof buildOpenAPIDocument>): string[] {
  const registry = new Set<string>(PERMISSIONS);
  const violations: string[] = [];
  for (const { path, method, operation } of operations(document)) {
    const permission = operation["x-mc-permission"];
    if (permission == null) continue;
    const label = `${method.toUpperCase()} ${path}`;
    if (typeof permission !== "string" || !registry.has(permission)) {
      violations.push(
        `${label}: x-mc-permission ${JSON.stringify(permission)} is not in the registry`,
      );
      continue;
    }
    const namespace = permission.split(":")[0] ?? "";
    const resource = operation["x-mc-resource"];
    const expectedResource = RESOURCE_BY_PERMISSION_NAMESPACE[namespace];
    if (expectedResource === undefined) {
      violations.push(
        `${label}: permission namespace "${namespace}" has no RESOURCE_BY_PERMISSION_NAMESPACE binding`,
      );
      continue;
    }
    if (resource !== expectedResource) {
      violations.push(
        `${label}: permission namespace "${namespace}" must bind to x-mc-resource "${expectedResource}", got "${String(resource)}"`,
      );
    }
  }
  return violations;
}

// Rule: every route in a money/trust/payment/comms subsystem declares idempotency: required.
function moneyIdempotencyViolations(
  document: ReturnType<typeof buildOpenAPIDocument>,
  moneyNamespaces: ReadonlySet<string>,
): string[] {
  const violations: string[] = [];
  for (const { path, method, operation, namespace } of operations(document)) {
    if (!moneyNamespaces.has(namespace)) continue;
    if (operation["x-mc-idempotency"] !== "required") {
      violations.push(
        `${method.toUpperCase()} ${path}: ${namespace} is a money subsystem — x-mc-idempotency must be "required"`,
      );
    }
  }
  return violations;
}

// Safety net for the empty MONEY_NAMESPACES: a money-looking route (namespace ∈ keywords) that is not
// registered in MONEY_NAMESPACES would silently escape moneyIdempotencyViolations. Flag it so a money
// slice cannot add a route without wiring it into the idempotency gate (catches the forgotten
// registration mechanically, rather than relying on the author's memory).
function moneyRegistrationGapViolations(
  document: ReturnType<typeof buildOpenAPIDocument>,
  keywords: ReadonlySet<string>,
  moneyNamespaces: ReadonlySet<string>,
): string[] {
  const violations: string[] = [];
  for (const { path, method, namespace } of operations(document)) {
    if (keywords.has(namespace) && !moneyNamespaces.has(namespace)) {
      violations.push(
        `${method.toUpperCase()} ${path}: "${namespace}" is a money subsystem — add it to MONEY_NAMESPACES so the idempotency-required gate covers it`,
      );
    }
  }
  return violations;
}

// Rule: authenticated: false requires an explicit PUBLIC_ALLOW_LIST entry with a justification.
function publicAllowListViolations(
  document: ReturnType<typeof buildOpenAPIDocument>,
  allowList: Record<string, string>,
): string[] {
  const violations: string[] = [];
  for (const { path, method, operation, operationId } of operations(document)) {
    if (operation["x-mc-authenticated"] !== false) continue;
    const justification = allowList[operationId];
    if (justification === undefined || justification.trim() === "") {
      violations.push(
        `${method.toUpperCase()} ${path}: authenticated: false requires a PUBLIC_ALLOW_LIST entry with a justification (operationId "${operationId}")`,
      );
    }
  }
  return violations;
}

// Rule: `surface` is internally consistent — valid value, and the app (cookie-session) surface is never
// anonymous. The mechanism-level assertion (an `app` route never bearer, a `public` route never cookie)
// attaches when the auth surfaces emit OpenAPI security schemes — deferred; the boolean coherence is
// what the emitted document can enforce today.
function surfaceConsistencyViolations(document: ReturnType<typeof buildOpenAPIDocument>): string[] {
  const valid = new Set(["app", "public", "portal"]);
  const violations: string[] = [];
  for (const { path, method, operation } of operations(document)) {
    const label = `${method.toUpperCase()} ${path}`;
    const surface = operation["x-mc-surface"];
    if (typeof surface !== "string" || !valid.has(surface)) {
      violations.push(
        `${label}: x-mc-surface ${JSON.stringify(surface)} is not one of app|public|portal`,
      );
      continue;
    }
    if (surface === "app" && operation["x-mc-authenticated"] !== true) {
      violations.push(`${label}: an app-surface (cookie-session) route is never anonymous`);
    }
  }
  return violations;
}

// Rule: every operationId is unique and matches subsystem.action.
function operationIdViolations(document: ReturnType<typeof buildOpenAPIDocument>): string[] {
  const violations: string[] = [];
  const seen = new Map<string, string>();
  for (const { path, method, operation } of operations(document)) {
    const label = `${method.toUpperCase()} ${path}`;
    const operationId = operation.operationId;
    if (typeof operationId !== "string" || !OPERATION_ID_SHAPE.test(operationId)) {
      violations.push(
        `${label}: operationId ${JSON.stringify(operationId)} must match subsystem.action`,
      );
      continue;
    }
    const prior = seen.get(operationId);
    if (prior !== undefined) {
      violations.push(`${label}: operationId "${operationId}" already used by ${prior}`);
    } else {
      seen.set(operationId, label);
    }
  }
  return violations;
}

// Rule: every registered component NAME maps to exactly one schema shape.
// zod-to-openapi 1.4.0 silently first-write-wins on a duplicate .openapi(name), so two distinct schemas
// under one name produce a document where one masquerades as the other — invisible in the deduped
// document. We re-emit each route in isolation and compare the JSON-Schema each component name produces:
// a collision (same name, different shape across routes) is caught; correct shared reuse (Problem,
// referenced by many routes with one shape) passes.
function componentNameCollisions(app: ReturnType<typeof createApp>): string[] {
  const shapesByName = new Map<string, Set<string>>();
  for (const definition of app.openAPIRegistry.definitions) {
    if (definition.type !== "route") continue;
    const isolated = new OpenAPIHono();
    isolated.openapi(definition.route, (c: any) => c.json({}, 200));
    const document = isolated.getOpenAPI31Document({
      openapi: "3.1.0",
      info: { title: "isolated", version: "0.0.0" },
    }) as { components?: { schemas?: Record<string, unknown> } };
    for (const [name, schema] of Object.entries(document.components?.schemas ?? {})) {
      const shapes = shapesByName.get(name) ?? new Set<string>();
      shapes.add(JSON.stringify(schema));
      shapesByName.set(name, shapes);
    }
  }
  const violations: string[] = [];
  for (const [name, shapes] of shapesByName) {
    if (shapes.size > 1) {
      violations.push(
        `component "${name}" is registered under ${shapes.size} distinct schema shapes`,
      );
    }
  }
  return violations;
}

// Resolve a response schema, following a single `$ref` into components/schemas (the shape
// zod-to-openapi emits for a named .openapi() schema like Problem).
//
// KNOWN SEAM (review 2026-06-13, low): this follows ONE top-level $ref and does NOT recurse through
// composition (allOf/oneOf/anyOf) or a $ref chain. Acceptable: every error response points directly
// at the single Problem component ("the one error shape platform-wide"), and a future composed error
// schema would FALSE-POSITIVE (a loud CI failure), never silently let a non-conforming route through
// — the safe direction. Recurse through composition here if composed error schemas are ever adopted.
function resolveSchema(
  schema: unknown,
  schemas: Record<string, { properties?: Record<string, unknown> }>,
): { properties?: Record<string, unknown> } | undefined {
  if (schema === null || typeof schema !== "object") return undefined;
  if ("$ref" in schema) {
    const name = String((schema as { $ref: string }).$ref)
      .split("/")
      .pop();
    return name ? schemas[name] : undefined;
  }
  return schema as { properties?: Record<string, unknown> };
}

// Rule: every error response (4xx/5xx) declares the observability errorId — the public key joining a
// user-visible failure to its redacted server trace. An error response with no schema, or one whose
// schema omits errorId, fails: the client must always have an Error ID to quote.
function errorIdCoverageViolations(document: ReturnType<typeof buildOpenAPIDocument>): string[] {
  const schemas = (document.components?.schemas ?? {}) as Record<
    string,
    { properties?: Record<string, unknown> }
  >;
  const violations: string[] = [];
  for (const { path, method, operation } of operations(document)) {
    const responses = (operation as { responses?: Record<string, unknown> }).responses ?? {};
    for (const [statusCode, response] of Object.entries(responses)) {
      if (Number(statusCode) < 400) continue; // error responses only
      const label = `${method.toUpperCase()} ${path} ${statusCode}`;
      const content =
        (response as { content?: Record<string, { schema?: unknown }> }).content ?? {};
      const mediaTypes = Object.values(content);
      const declaresErrorId =
        mediaTypes.length > 0 &&
        mediaTypes.every(
          (media) => resolveSchema(media.schema, schemas)?.properties?.["errorId"] !== undefined,
        );
      if (!declaresErrorId) {
        violations.push(`${label}: error response must declare an errorId (RFC 9457)`);
      }
    }
  }
  return violations;
}

// Normalize a Hono route path to the OpenAPI path syntax: Hono templates a parameter as `:name`, the
// emitted document as `{name}`. Trailing slashes are dropped so `/api/v1/x/` and `/api/v1/x` compare
// equal. This is the join key between app.routes (what Hono will actually dispatch) and the document
// (what went through defineOpenAPIRoute, the only registration path that composes the chokepoint).
function honoPathToOpenAPI(path: string): string {
  const templated = path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
  return templated.length > 1 && templated.endsWith("/") ? templated.slice(0, -1) : templated;
}

// The set of /api/v1 paths the emitted document exposes — i.e. every path registered via
// defineOpenAPIRoute (the chokepoint-composing path) and nothing else.
function documentedApiV1Paths(document: ReturnType<typeof buildOpenAPIDocument>): Set<string> {
  const paths = new Set<string>();
  for (const path of Object.keys(document.paths ?? {})) {
    if (path.startsWith("/api/v1")) paths.add(honoPathToOpenAPI(path));
  }
  return paths;
}

// The distinct /api/v1 paths Hono will actually dispatch in the given app (app.routes is the live
// dispatch table: every registered handler/middleware, {method, path}). Normalized to OpenAPI syntax.
function dispatchedApiV1Paths(app: ReturnType<typeof createApp>): Set<string> {
  const paths = new Set<string>();
  for (const { path } of app.routes) {
    if (path.startsWith("/api/v1")) paths.add(honoPathToOpenAPI(path));
  }
  return paths;
}

// Rule: every /api/v1 path Hono will dispatch is present in the emitted document — i.e. it was
// registered via defineOpenAPIRoute, the ONLY registration path that composes the chokepoint. A bare
// app.get("/api/v1/...") would dispatch (appear in app.routes) yet never enter the document, silently
// skipping tenancy/authn/RBAC/idempotency/rate-limit enforcement AND every other fitness function
// above (which all read the document). This structural gate is what makes "every /api/v1 route goes
// through the chokepoint" provable rather than convention.
function chokepointCompositionViolations(app: ReturnType<typeof createApp>): string[] {
  const documented = documentedApiV1Paths(emitOpenAPIDocument(app));
  const violations: string[] = [];
  for (const path of dispatchedApiV1Paths(app)) {
    if (!documented.has(path)) {
      violations.push(
        `${path}: dispatched under /api/v1 but absent from the OpenAPI document — it was not ` +
          `registered via defineOpenAPIRoute, so it bypasses the chokepoint`,
      );
    }
  }
  return violations;
}

// --- Negative-control helpers: build a one-route document from arbitrary meta, never committed. ---
const okResponse = {
  200: {
    description: "OK",
    content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
  },
} as const;

function baseMeta(overrides: Partial<RouteMeta> = {}): RouteMeta {
  return {
    operationId: "widgets.list",
    surface: "app",
    authenticated: true,
    permission: "firm:manageMembers",
    resource: "firm",
    audited: true,
    idempotency: "optional",
    rateLimit: "default",
    ...overrides,
  };
}

function documentForRoute(
  meta: RouteMeta,
  route: { method: "get" | "post"; path: string },
): ReturnType<typeof buildOpenAPIDocument> {
  const app = new OpenAPIHono();
  const bundle = defineOpenAPIRoute(meta, {
    method: route.method,
    path: route.path,
    description: "A deliberately-constructed route for the conformance negative control.",
    responses: okResponse,
  });
  app.openapi(bundle, (c: any) => c.json({ ok: true }, 200));
  return app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: { title: "neg", version: "0.0.0" },
  }) as ReturnType<typeof buildOpenAPIDocument>;
}

// Some invariants are ALSO guarded by defineOpenAPIRoute at registration time (operationId shape, a
// null permission on an authenticated mutating route), so a bad bundle can't be built through it. The
// fitness function is the document-level backstop (against a hand-edited snapshot, or a route not built
// through defineOpenAPIRoute), so its negative control feeds a raw operation document directly.
function documentWithOperations(
  routes: { method: string; path: string; operation: Record<string, unknown> }[],
): ReturnType<typeof buildOpenAPIDocument> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const { method, path, operation } of routes) {
    paths[path] = { ...paths[path], [method]: operation };
  }
  return { openapi: "3.1.0", info: { title: "raw", version: "0.0.0" }, paths } as ReturnType<
    typeof buildOpenAPIDocument
  >;
}

// A well-formed operation object carrying the x-mc-* posture, for raw negative controls to mutate.
function rawOperation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    operationId: "widgets.list",
    "x-mc-operationId": "widgets.list",
    "x-mc-surface": "app",
    "x-mc-authenticated": true,
    "x-mc-permission": "firm:manageMembers",
    "x-mc-resource": "firm",
    "x-mc-audited": true,
    "x-mc-idempotency": "optional",
    "x-mc-rateLimit": "default",
    responses: { 200: { description: "OK" } },
    ...overrides,
  };
}

describe("conformance — the committed contract holds, and each rule catches a bad route", () => {
  const document = buildOpenAPIDocument();

  // Guards the suite against vacuity: if operations() yielded nothing, every `toEqual([])` below would
  // pass trivially. Assert the document exposes exactly the operations we expect to enforce over.
  it("exposes the known committed operations (so the positive assertions are not vacuous)", () => {
    const ids = [...operations(document)].map((entry) => entry.operationId).sort();
    expect(ids).toEqual([
      "aiDetection.detect",
      "conversions.status",
      "conversions.submit",
      "conversions.upload",
      "costs.approve",
      "costs.attachReceipt",
      "costs.batch",
      "costs.create",
      "costs.detachReceipt",
      "costs.get",
      "costs.kickBack",
      "costs.list",
      "costs.submit",
      "costs.update",
      "costs.void",
      "customFields.applyConvert",
      "customFields.archiveField",
      "customFields.archiveOption",
      "customFields.clearValue",
      "customFields.createOption",
      "customFields.defineField",
      "customFields.hardDeleteField",
      "customFields.hardDeleteOption",
      "customFields.listRecordValues",
      "customFields.previewConvert",
      "customFields.purgeField",
      "customFields.renameField",
      "customFields.renameOption",
      "customFields.reorderField",
      "customFields.reorderOption",
      "customFields.resolveField",
      "customFields.setRequired",
      "customFields.setValue",
      "customFields.unarchiveField",
      "customFields.valueHistory",
      "decryption.inspect",
      "decryption.unlock",
      "directory.addIdentifier",
      "directory.addName",
      "directory.assignCategory",
      "directory.createCategory",
      "directory.createEdge",
      "directory.createOrganization",
      "directory.createPerson",
      "directory.duplicateCandidates",
      "directory.getOrganization",
      "directory.getPerson",
      "directory.linkMatterParty",
      "directory.merge",
      "directory.readIdentifier",
      "directory.search",
      "documentTypes.create",
      "documentTypes.deactivate",
      "documentTypes.list",
      "documentTypes.update",
      "documents.checkin",
      "documents.checkout",
      "documents.editSession",
      "documents.forceRelease",
      "documents.reconcile",
      "documents.viewSession",
      "downloads.bundleStatus",
      "downloads.zip",
      "fileIntegrity.hash",
      "fileIntegrity.verify",
      "fileType.verify",
      "files.delete",
      "files.download",
      "files.get",
      "files.list",
      "files.preview",
      "files.update",
      "files.versions",
      "firm.setReleaseChannel",
      "firmUsage.get",
      "firms.provision",
      "folders.create",
      "folders.delete",
      "folders.update",
      "health.read",
      "incidents.report",
      "locations.assignMember",
      "locations.close",
      "locations.create",
      "locations.get",
      "locations.list",
      "locations.setAddresses",
      "locations.update",
      "matterTypes.create",
      "matterTypes.deactivate",
      "matterTypes.list",
      "matterTypes.update",
      "matters.close",
      "matters.create",
      "matters.get",
      "matters.list",
      "matters.listConsultations",
      "matters.open",
      "matters.renumber",
      "matters.reopen",
      "matters.update",
      "me.get",
      "members.invite",
      "metadata.inspect",
      "metadata.scrub",
      "myDay.get",
      "narrativeTemplates.create",
      "narrativeTemplates.list",
      "narrativeTemplates.recentNarratives",
      "nonBillableCategories.archive",
      "nonBillableCategories.create",
      "nonBillableCategories.list",
      "nonBillableCategories.update",
      "numbering.get",
      "numbering.preview",
      "numbering.set",
      "platform.setFirmReleaseChannel",
      "rateCards.create",
      "rateCards.list",
      "rates.append",
      "rates.reRateDrafts",
      "safeBrowse.post",
      "scan.diagnose",
      "scan.matter",
      "scanPolicy.get",
      "scanPolicy.scoreHistogram",
      "scanPolicy.update",
      "shipping.connect",
      "shipping.createShipment",
      "shipping.label",
      "shipping.purchase",
      "shipping.rateShipment",
      "shipping.refund",
      "shipping.tracking",
      "supportDiagnostics.overview",
      "supportGrants.cosign",
      "supportGrants.list",
      "supportGrants.request",
      "supportGrants.revoke",
      "supportSessions.redeem",
      "timeEntries.approve",
      "timeEntries.create",
      "timeEntries.get",
      "timeEntries.gridBatch",
      "timeEntries.kickBack",
      "timeEntries.list",
      "timeEntries.previewQuickAdd",
      "timeEntries.submit",
      "timeEntries.update",
      "timeEntries.void",
      "timer.bind",
      "timer.discard",
      "timer.pause",
      "timer.read",
      "timer.resume",
      "timer.start",
      "timer.stopCommit",
      "uploads.abort",
      "uploads.complete",
      "uploads.initiate",
      "uploads.signPart",
      "utbmsCodes.disable",
      "utbmsCodes.enable",
      "utbmsCodes.list",
      "whois.get",
    ]);
  });

  describe("authenticated mutating routes are audited and name a permission", () => {
    it("the committed contract satisfies it", () => {
      expect(auditedMutatingViolations(document)).toEqual([]);
    });
    it("flags an authenticated mutating route that is not audited", () => {
      const bad = documentForRoute(baseMeta({ audited: false }), {
        method: "post",
        path: "/api/v1/widgets",
      });
      expect(auditedMutatingViolations(bad).length).toBeGreaterThan(0);
    });
    it("flags an authenticated mutating route with a null permission (raw — defineOpenAPIRoute guards this at registration)", () => {
      const bad = documentWithOperations([
        {
          method: "post",
          path: "/api/v1/widgets",
          operation: rawOperation({ "x-mc-permission": null }),
        },
      ]);
      expect(auditedMutatingViolations(bad).length).toBeGreaterThan(0);
    });
  });

  describe("named permissions exist in the registry with a matching subsystem", () => {
    it("the committed contract satisfies it", () => {
      expect(permissionRegistryViolations(document)).toEqual([]);
    });
    it("flags a permission absent from the registry", () => {
      const bad = documentForRoute(
        baseMeta({ permission: "firm:bogusAction" as RouteMeta["permission"] }),
        { method: "post", path: "/api/v1/widgets" },
      );
      expect(permissionRegistryViolations(bad).length).toBeGreaterThan(0);
    });
    it("flags a permission whose namespace does not match the resource", () => {
      const bad = documentForRoute(
        baseMeta({ permission: "firm:manageMembers", resource: "matter" }),
        {
          method: "post",
          path: "/api/v1/widgets",
        },
      );
      expect(permissionRegistryViolations(bad).length).toBeGreaterThan(0);
    });
  });

  describe("money-subsystem routes require idempotency (machinery; namespace set empty today)", () => {
    it("no committed money-looking route escaped MONEY_NAMESPACES (the registration safety net)", () => {
      expect(
        moneyRegistrationGapViolations(document, MONEY_SUBSYSTEM_KEYWORDS, MONEY_NAMESPACES),
      ).toEqual([]);
    });
    it("flags a money-looking route that was not registered in MONEY_NAMESPACES", () => {
      const bad = documentWithOperations([
        {
          method: "post",
          path: "/api/v1/trust",
          operation: rawOperation({ "x-mc-operationId": "trust.disburse" }),
        },
      ]);
      expect(
        moneyRegistrationGapViolations(bad, MONEY_SUBSYSTEM_KEYWORDS, MONEY_NAMESPACES).length,
      ).toBeGreaterThan(0);
    });
    it("flags a money-subsystem route declaring idempotency optional", () => {
      const bad = documentForRoute(
        baseMeta({ operationId: "payments.charge", idempotency: "optional" }),
        {
          method: "post",
          path: "/api/v1/payments",
        },
      );
      expect(moneyIdempotencyViolations(bad, new Set(["payments"])).length).toBeGreaterThan(0);
    });
  });

  describe("anonymous routes are explicitly allow-listed", () => {
    it("the committed contract satisfies it", () => {
      expect(publicAllowListViolations(document, PUBLIC_ALLOW_LIST)).toEqual([]);
    });
    it("flags an authenticated: false route that is not in the allow-list", () => {
      const bad = documentForRoute(
        baseMeta({
          operationId: "intake.submit",
          surface: "public",
          authenticated: false,
          permission: null,
        }),
        { method: "post", path: "/api/v1/intake" },
      );
      expect(publicAllowListViolations(bad, PUBLIC_ALLOW_LIST).length).toBeGreaterThan(0);
    });
  });

  describe("surface is internally consistent", () => {
    it("the committed contract satisfies it", () => {
      expect(surfaceConsistencyViolations(document)).toEqual([]);
    });
    it("flags an app-surface route that is anonymous", () => {
      const bad = documentForRoute(
        baseMeta({ surface: "app", authenticated: false, permission: null }),
        {
          method: "get",
          path: "/api/v1/widgets",
        },
      );
      expect(surfaceConsistencyViolations(bad).length).toBeGreaterThan(0);
    });
  });

  describe("operationIds are unique and well-shaped", () => {
    it("the committed contract satisfies it", () => {
      expect(operationIdViolations(document)).toEqual([]);
    });
    it("flags a malformed operationId (raw — defineOpenAPIRoute guards the shape at registration)", () => {
      const bad = documentWithOperations([
        {
          method: "get",
          path: "/api/v1/widgets",
          operation: rawOperation({
            operationId: "Widgets_List",
            "x-mc-operationId": "Widgets_List",
          }),
        },
      ]);
      expect(operationIdViolations(bad).length).toBeGreaterThan(0);
    });
    it("flags a duplicate operationId across two routes (raw)", () => {
      const bad = documentWithOperations([
        { method: "get", path: "/api/v1/widgets", operation: rawOperation() },
        { method: "get", path: "/api/v1/gadgets", operation: rawOperation() },
      ]);
      expect(operationIdViolations(bad).length).toBeGreaterThan(0);
    });
  });

  describe("every error response declares an errorId", () => {
    it("the committed contract satisfies it", () => {
      expect(errorIdCoverageViolations(document)).toEqual([]);
    });
    it("flags an error response whose schema omits errorId", () => {
      const bad = documentWithOperations([
        {
          method: "post",
          path: "/api/v1/widgets",
          operation: rawOperation({
            responses: {
              200: { description: "OK" },
              404: {
                description: "Not found",
                content: {
                  "application/problem+json": {
                    schema: { type: "object", properties: { title: { type: "string" } } },
                  },
                },
              },
            },
          }),
        },
      ]);
      expect(errorIdCoverageViolations(bad).length).toBeGreaterThan(0);
    });
    it("flags an error response that declares no content at all", () => {
      const bad = documentWithOperations([
        {
          method: "get",
          path: "/api/v1/widgets",
          operation: rawOperation({
            responses: { 200: { description: "OK" }, 500: { description: "Server error" } },
          }),
        },
      ]);
      expect(errorIdCoverageViolations(bad).length).toBeGreaterThan(0);
    });
  });

  describe("component names map to a single schema shape", () => {
    it("the committed contract satisfies it", () => {
      expect(componentNameCollisions(createApp())).toEqual([]);
    });
    it("flags two distinct schemas registered under one name", () => {
      const app = new OpenAPIHono();
      const first = defineOpenAPIRoute(baseMeta({ operationId: "widgets.first" }), {
        method: "get",
        path: "/api/v1/widgets/first",
        description: "First route registering the colliding component.",
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": { schema: z.object({ a: z.string() }).openapi("Collide") },
            },
          },
        },
      });
      const second = defineOpenAPIRoute(baseMeta({ operationId: "widgets.second" }), {
        method: "get",
        path: "/api/v1/widgets/second",
        description: "Second route registering a DIFFERENT schema under the same name.",
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": { schema: z.object({ b: z.number() }).openapi("Collide") },
            },
          },
        },
      });
      app.openapi(first, (c: any) => c.json({ a: "x" }, 200));
      app.openapi(second, (c: any) => c.json({ b: 1 }, 200));
      expect(componentNameCollisions(app as ReturnType<typeof createApp>).length).toBeGreaterThan(
        0,
      );
    });
  });

  describe("every dispatched /api/v1 route composes the chokepoint (is in the document)", () => {
    // Build a production app (NO options) so the test-only telemetry probes — which ARE bare
    // app.get("/api/v1/__telemetry-*") routes deliberately outside the contract — are absent. Under
    // production wiring, the only /api/v1 routes Hono dispatches are the defineOpenAPIRoute-registered
    // ones, so the dispatch table and the document must agree exactly.
    const productionApp = createApp();

    it("the committed contract satisfies it", () => {
      expect(chokepointCompositionViolations(productionApp)).toEqual([]);
    });

    it("is not vacuous — it actually sees the real /api/v1 operations", () => {
      const dispatched = dispatchedApiV1Paths(productionApp);
      // A spot-check of paths the committed routes register: if enumeration silently saw nothing,
      // the positive assertion above would pass trivially. These must be present.
      expect(dispatched.has("/api/v1/me")).toBe(true);
      expect(dispatched.has("/api/v1/matters")).toBe(true);
      expect(dispatched.has("/api/v1/files/{id}")).toBe(true);
      expect(dispatched.size).toBeGreaterThan(10);
    });

    it("flags a bare-registered /api/v1 route absent from the document (skips the chokepoint)", () => {
      // A throwaway app with a route mounted the WRONG way: a raw app.get, not defineOpenAPIRoute. It
      // dispatches (enters app.routes) yet never enters the document — exactly the bypass this gate
      // exists to catch.
      const bare = createApp();
      bare.get("/api/v1/__conformance_probe", (c) => c.json({ ok: true }));
      const violations = chokepointCompositionViolations(bare);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations.some((v) => v.includes("/api/v1/__conformance_probe"))).toBe(true);
    });
  });
});
