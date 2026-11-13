// RouteMeta + defineOpenAPIRoute: every route carries machine-readable metadata so each
// cross-cutting concern is a property of the traversed path — enforced at the one chokepoint
// middleware and provable in CI over the emitted document, never per-handler discipline. A field
// belongs here only if the chokepoint, a fitness function, or codegen consumes it; the reserved
// seams (cache, planTier, metered) stay unpopulated until their owning feature is built.
//
// Note: @hono/zod-openapi exports its own (unrelated) defineOpenAPIRoute helper for route+handler
// bundles; this module's defineOpenAPIRoute is the platform wrapper around createRoute and is the
// only one route modules import.
import { createRoute, z } from "@hono/zod-openapi";
import type { RouteConfig } from "@hono/zod-openapi";
import type { KnownPermission, Permission } from "@magna-carta/access-control/registry";
import { reversalDeclarationProblem, type RouteReversal } from "./reversal.ts";

export type RateLimitBucket =
  | "default"
  | "auth"
  | "expensive"
  | "incident-report"
  | "guest-arrival"
  | "meeting-question-upvote"
  | "provider-notice";

export interface RouteMeta {
  operationId: string; // 'subsystem.action' — ^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$
  surface: "app" | "public" | "portal";
  authenticated: boolean;
  // Capability required from the access-control registry; null only when authenticated: false.
  // KnownPermission admits compile-checked literals (the registry's documented authoring type — a
  // branded Permission cannot be written literally); Permission admits runtime-validated values.
  permission: KnownPermission | Permission | null;
  resource: "matter" | "firm" | "location" | "directoryEntity" | "portalShare";
  audited: boolean; // writes an immutable audit entry
  idempotency: "required" | "optional"; // required on money/trust/payment/outbound-comms
  // Where a required-idempotency route's record commits — it MUST be the same database the handler
  // writes its business effect to, so the record + business + outbox ride one atomic batch (the
  // slice 0·2 idempotent write path). "firm" (the default for app/portal surfaces) uses the session
  // firm's physically-isolated per-firm idempotency_key table, keyed by the raw client key. "control"
  // is for the rare app-surface route whose business is itself control-plane (members.invite creates
  // a control-plane user) and for the public platform surface (firms.provision) — the shared
  // control-plane table, tenant-scoped in the key. Read only by the chokepoint idempotency port;
  // not emitted into the contract (an internal routing fact, not part of the public API surface).
  idempotencyStore?: "firm" | "control";
  // What a required-idempotency route's stored fingerprint is computed over. Defaults to "request":
  // the method, the path and the canonical body, so a key reused for a different body is refused
  // 422 before the handler runs. "path" leaves the BODY out, for a route whose body is something the
  // stored record must not be able to give back: the fingerprint is an unsalted digest kept beside
  // the response, and a body drawn from a small set — a choice among a poll's ten options — is
  // recovered from it by hashing each candidate. The price is stated where it is paid: a retry under
  // the same key with a different body is no longer told apart, and is answered as the first was.
  // A "path" route also takes no pre-decision from the gate: its stored response is a pointer rather
  // than the reply, so the handler's own commit path re-reads the record and answers a retry from
  // it. Read only by the chokepoint idempotency port; not emitted into the contract, like
  // idempotencyStore.
  idempotencyFingerprint?: "request" | "path";
  rateLimit: RateLimitBucket;
  // What this route does with a session that carries NO firm — the state a person is in between
  // making an account and resolving what it is (founding a firm, or redeeming an invitation).
  // Defaults to "reject", so every route that does not think about it fails CLOSED: a firmless
  // session gets the same reserved absence a cross-firm request gets.
  //   "reject" — the reserved 404. Every route in the platform but the joining ones.
  //   "allow"  — admitted with no firm context and no capability check; a session that HAS a firm
  //              is resolved exactly as always. For a read that must answer both (the bootstrap).
  //   "only"   — admitted with no firm context; a session that HAS a firm gets the reserved 404.
  //              This is what makes an authenticated mutation legal with permission: null — a
  //              principal with no firm holds no capability in any firm, so there is none to name,
  //              and "only" earns that by making the route unreachable for anybody who has one.
  // Read only by the chokepoint, and deliberately not emitted into the contract — like
  // idempotencyStore, it routes a request inside this Worker rather than describing the wire. What
  // a caller observes is already in the document: the reserved 404 every one of these routes
  // declares.
  firmlessSession?: "reject" | "allow" | "only";
  // What this route does when the session's firm DATABASE cannot be reached at all — distinct from
  // the firm being absent, which is already the reserved 404. The per-firm lineage is applied in the
  // FirmDatabase durable object's constructor, ahead of any read or write it serves, so a migration
  // that cannot complete does not degrade one screen: it makes the firm's whole database unreachable
  // and the chokepoint's own member-active check throw.
  // Defaults to "reject", so every route that has not thought about it fails CLOSED.
  //   "reject"   — the throw propagates and the route answers 500. Every route that serves firm
  //                data: membership could not be verified, so nothing may be served on it.
  //   "tolerate" — admitted with the context the control plane alone could build, and no
  //                permissions. Legal ONLY with permission: null and only for a route that reads no
  //                firm data, which is why registration refuses any other combination. This exists
  //                for the DIAGNOSTIC reads. They were firm-scoped like everything else, so an
  //                unreachable firm database took down the two surfaces whose entire job is to say
  //                that the firm database is unreachable — the one question an operator has at that
  //                moment, answered by a blank panel.
  firmDatabaseOutage?: "reject" | "tolerate";
  tags?: string[]; // default: [operationId namespace] — applied when absent OR empty
  deprecated?: boolean;
  /**
   * What putting this operation back MEANS (contracts/reversal.ts).
   *
   * REQUIRED ON EVERY DELETE, refused at registration otherwise. Deletion is where the question is
   * asked most and was answered least — thirty-three DELETE operations against five reversals of any
   * kind when this landed — so the gate starts there rather than everywhere, and widens as the other
   * mutating methods are worked through. Optional elsewhere and validated wherever it appears.
   */
  reversal?: RouteReversal;
  /**
   * THE MEETING GUEST'S LANE — a route reached by somebody from outside the firm holding a signed
   * credential rather than a session. Absent on every other route in the platform, and absent means
   * nothing changes at all.
   *
   *   "invitation" — the link the e-mail carries, in the `x-meeting-guest` header.
   *   "grant"      — the credential an arrival mints, in the same header, or in the `guest` query
   *                  parameter on a WebSocket upgrade and nowhere else.
   *
   * Present, the chokepoint admits the request through the lane INSTEAD of the session path: it never
   * resolves a session, never loads a permission, and stashes the firm and the credential but never a
   * user id — so a member handler pointed at a guest route fails on its first line. Registration
   * refuses the field unless the route is also `authenticated: false`, `permission: null`,
   * `surface: "app"` and `resource: "firm"`: there is no principal to hold a capability, so a guest
   * route cannot be written that names one.
   */
  guestLane?: "invitation" | "grant";
  /**
   * An outside signer's lane, for the routes a signer's page calls. The one value, "link", is the
   * link the signing email carries, in the `x-signing-link` header and nowhere else.
   *
   * It is a lane of its own rather than a third guest lane because the two credentials name
   * different things (a meeting's invitation, a request's signer) and a handler of one must never be
   * handed the other. Registration holds it to the guest lane's terms: `authenticated: false`,
   * `permission: null`, `surface: "app"` and `resource: "firm"`, and never beside `guestLane`.
   */
  signerLane?: "link";
}

// The meta as attached to a defined route: optional fields resolved to their defaults, so the
// chokepoint and the conformance suite never re-derive them.
export interface ResolvedRouteMeta extends RouteMeta {
  tags: string[];
  deprecated: boolean;
  firmlessSession: "reject" | "allow" | "only";
}

const OPERATION_ID_PATTERN = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;

// The HTTP methods that mutate state — the single home shared by defineOpenAPIRoute's
// authenticated-null guard (below) and the conformance fitness functions, so "what counts as
// mutating" cannot drift between the registration guard and the contract gate.
export const MUTATING_METHODS: ReadonlySet<string> = new Set(["post", "put", "patch", "delete"]);
export const isMutatingMethod = (method: string): boolean =>
  MUTATING_METHODS.has(method.toLowerCase());

// Meta rides on the returned route object via a WeakMap, not a magic property, so the route
// config stays exactly what @hono/zod-openapi expects and the association cannot leak into the
// emitted document or serialization.
const routeMetaByRoute = new WeakMap<object, ResolvedRouteMeta>();

// The chokepoint accessor: the resolved meta for a route returned by defineOpenAPIRoute.
//
// Keying constraint: the argument must be the EXACT object defineOpenAPIRoute returned — the
// WeakMap key does not survive past registration. app.openapi({ middleware, hide, ...route },
// handler) rest-destructures the route config (verified in @hono/zod-openapi 1.4.0), so the
// library's openAPIRegistry stores a shallow COPY (routeMetaOf on a registry definition returns
// undefined), and Hono's request-time c.req.matchedRoutes never references the createRoute
// object at all. Consequence: meta must be resolved at REGISTRATION time — app.ts iterating the
// route bundles, or per-route middleware closing over the meta — never looked up from the
// matched route at request time.
export function routeMetaOf(route: object): ResolvedRouteMeta | undefined {
  return routeMetaByRoute.get(route);
}

// createRoute's config has description optional; the platform requires it (Spectral's
// operation-description rule, and the generated SDK docs read it) — so the wrapper's parameter
// type demands it at compile time (negative-compile assertion: test/contracts/route-meta-types.ts).
type DescribedRouteConfig<P extends string> = Omit<RouteConfig, "path"> & {
  path: P;
  description: string;
};

// A request body media type the chokepoint's required-idempotency gate can fingerprint safely.
// The gate derives its fingerprint with `req.json()`, which populates Hono's body cache with the
// DECODED TEXT; every later read of the body is re-encoded from that cached text, so bytes that are
// not valid UTF-8 do not survive the round trip and a handler's own `arrayBuffer()` either returns
// mangled bytes or inherits the cached rejection. JSON (and the `+json` structured-suffix family) is
// text by definition, so it round-trips exactly; anything else does not.
const JSON_MEDIA_TYPE_PATTERN = /^application\/json$|\+json$/;

// The media types a route's declared request body offers that the fingerprint cannot round-trip.
// Exported so the conformance fitness function over the emitted document applies the SAME rule this
// registration-time guard applies — one definition of "non-JSON body", two enforcement points.
export function nonJsonRequestBodyMediaTypes(routeConfig: {
  request?: { body?: { content?: Record<string, unknown> } };
}): string[] {
  const content = routeConfig.request?.body?.content;
  if (content === undefined) return [];
  return Object.keys(content).filter((mediaType) => !JSON_MEDIA_TYPE_PATTERN.test(mediaType));
}

// Documentation-only flip for idempotency-required routes: the shared
// idempotencyKeyHeader fragment is optional at the schema layer (presence enforcement belongs to
// the chokepoint middleware, which replies with the registered idempotency-key-missing problem),
// but the emitted document must advertise required: true so the generated client types the header
// required and Prism models it. zod-to-openapi spreads `.openapi({ param })` metadata over the
// optionality-derived `required`, and `.openapi()` clones the field schema — the shared fragment
// is never mutated. The wrap goes through `.extend()`, which preserves the object-level schema
// state (catchall, strict/strip mode, object-level refinements); the wrapped field's own runtime
// parse is unchanged. (Whether `.extend()` carries forward object-level `.openapi` metadata is
// untested and moot here: the shared idempotencyKeyHeader fragment carries no object-level
// `.openapi`, only per-field param metadata.)
function withRequiredIdempotencyKeyHeaderDocumentation<
  P extends string,
  R extends DescribedRouteConfig<P>,
>(routeConfig: R, operationId: string): R {
  const headersSchema = routeConfig.request?.headers;
  if (headersSchema !== undefined && !(headersSchema instanceof z.ZodObject)) {
    throw new TypeError(
      `Route ${JSON.stringify(operationId)} declares idempotency: "required" but its ` +
        `request.headers is not a single z.object — array and intersection header shapes are ` +
        `unsupported by the idempotency-key documentation flip; declare one z.object that ` +
        `includes the shared idempotencyKeyHeader fragment from contracts/common.`,
    );
  }
  const idempotencyKeyField = headersSchema?.shape["idempotency-key"];
  if (headersSchema === undefined || idempotencyKeyField === undefined) {
    throw new TypeError(
      `Route ${JSON.stringify(operationId)} declares idempotency: "required" but its ` +
        `request.headers does not declare the "idempotency-key" header — include the shared ` +
        `idempotencyKeyHeader fragment from contracts/common.`,
    );
  }
  const documentedHeaders = headersSchema.extend({
    "idempotency-key": idempotencyKeyField.openapi({ param: { required: true } }),
  });
  return {
    ...routeConfig,
    request: { ...routeConfig.request, headers: documentedHeaders },
  };
}

// The platform route definer: validates the operationId shape at definition time (fails at
// startup, like the chokepoint's registration-time assertions), defaults tags from the
// operationId namespace (an absent OR empty tags list — no route may reach the document
// untagged), sets the OpenAPI-native operationId/tags/deprecated (generators key SDK method
// names off the native operationId — docs/conventions/api.md), emits every meta
// field as an x-mc-* extension for the conformance fitness functions, and attaches the resolved
// meta for the chokepoint via routeMetaOf — keyed on the exact returned object; see the keying
// constraint on routeMetaOf (resolve meta at registration time, never from the matched route).
export function defineOpenAPIRoute<P extends string, R extends DescribedRouteConfig<P>>(
  meta: RouteMeta,
  routeConfig: R,
) {
  if (!OPERATION_ID_PATTERN.test(meta.operationId)) {
    throw new TypeError(
      `Malformed operationId ${JSON.stringify(meta.operationId)}: expected "subsystem.action" ` +
        `matching ${OPERATION_ID_PATTERN}.`,
    );
  }

  // Fail-closed access-control guards, asserted at definition time (startup), enforcing the
  // access-control invariants the chokepoint will TRUST without re-deriving. These are
  // RUNTIME asserts, not a type-level discriminated union on RouteMeta, BECAUSE the dangerous
  // invariant (#2 below) depends on the HTTP method — which lives in routeConfig.method, not on
  // RouteMeta — and on the mutating/non-mutating distinction. A discriminated union over RouteMeta
  // alone cannot see the method, so it cannot express the rule. The fitness function over the
  // emitted document remains the CI defense-in-depth backstop for the same invariants.
  //
  // #1 Public routes cannot name a capability: the chokepoint never reads a public route's
  // permission, so naming one is a confused contract that misleads the next reader.
  if (!meta.authenticated && meta.permission !== null) {
    throw new TypeError(
      `Route ${JSON.stringify(meta.operationId)} is public (authenticated: false) but names a ` +
        `permission ${JSON.stringify(meta.permission)} — the chokepoint ignores a public route's ` +
        `permission; set permission: null, or set authenticated: true if a capability is required.`,
    );
  }
  // #2 Authenticated mutating routes must name a non-null permission. The chokepoint reads
  // permission: null as "any authenticated user," so a mutating route authored with null permission
  // would let any logged-in user of any firm perform it — privilege escalation by omission. The
  // legitimate authenticated-null case is a NON-mutating read (e.g. GET /v1/me), so only mutating
  // methods trip this guard.
  if (
    isMutatingMethod(routeConfig.method) &&
    meta.authenticated &&
    meta.permission === null &&
    // The one exemption, and it is structural rather than a waiver: a "only"-firmless route is
    // unreachable for any session that HAS a firm (the chokepoint answers those the reserved 404),
    // so "any logged-in user" cannot mean "any member of any firm" here. The principal it does
    // admit belongs to no firm and therefore holds no capability in any firm — there is nothing to
    // name. "allow" gets no exemption: such a route serves firm-holding sessions too.
    meta.firmlessSession !== "only"
  ) {
    throw new TypeError(
      `Route ${JSON.stringify(meta.operationId)} is an authenticated ${routeConfig.method.toUpperCase()} ` +
        `(mutating) route but names permission: null — the chokepoint would read that as ` +
        `"any authenticated user," letting any logged-in user perform it (privilege escalation by ` +
        `omission); name the capability this mutation requires from the access-control registry.`,
    );
  }

  // #3 A route whose request body is raw bytes cannot use the chokepoint's required-idempotency
  // gate. The gate fingerprints the request by reading its body through Hono's body cache, which
  // caches the decoded TEXT — so a `.msg`, an image, or any other 8-bit body reaches the handler
  // re-encoded from that text (every invalid UTF-8 sequence replaced), and a handler that stores it
  // as the firm's verbatim original stores a corrupted copy that hashes to nothing. The supported
  // form for such a route is `idempotency: "optional"` plus the handler running runIdempotentEffect
  // itself, fingerprinted over the bytes it actually received — see
  // apps/api-worker/src/http/routes/email/emails.ts, which does exactly that. This is a startup failure rather than
  // a review convention because the corruption is silent at every layer below it.
  const nonJsonBodyTypes = nonJsonRequestBodyMediaTypes(routeConfig);
  if (meta.idempotency === "required" && nonJsonBodyTypes.length > 0) {
    throw new TypeError(
      `Route ${JSON.stringify(meta.operationId)} declares idempotency: "required" but its request ` +
        `body offers the non-JSON media type(s) ${nonJsonBodyTypes.map((type) => JSON.stringify(type)).join(", ")} — ` +
        `the required-idempotency gate fingerprints the body through Hono's text-decoding body ` +
        `cache, so those bytes would reach the handler mangled. Declare idempotency: "optional" ` +
        `and honour the Idempotency-Key in the handler, against the bytes it received.`,
    );
  }

  // #4 A DELETE must say what putting it back means (contracts/reversal.ts). Deletion is where the
  // question is asked most and was answered least — thirty-three DELETE operations against five
  // reversals of any kind when this gate landed — and the answer was living in hand-written dialog
  // copy that nothing checked. It is a startup failure rather than a review convention because the
  // cost of getting it wrong lands on a member who deleted something believing the sentence.
  if (routeConfig.method === "delete" && meta.reversal === undefined) {
    throw new TypeError(
      `Route ${JSON.stringify(meta.operationId)} is a DELETE and declares no reversal — say what ` +
        `putting it back means: an inverse naming the operation that does it (a route that reverses ` +
        `itself names itself), a compensating record that offsets it without putting it back, or ` +
        `none with the reason nothing does.`,
    );
  }
  const reversalProblem =
    meta.reversal === undefined ? undefined : reversalDeclarationProblem(meta.reversal);
  if (reversalProblem !== undefined) {
    throw new TypeError(`Route ${JSON.stringify(meta.operationId)}: ${reversalProblem}`);
  }

  // #5 A meeting guest's lane admits somebody who holds no session and never will, so the route may
  // claim nothing a session would carry. A guest route naming a capability would be a contract with
  // no principal to hold it; one marked authenticated would send a guest to the session path, which
  // has nothing to find; and a guest belongs to a FIRM's app surface — the lane resolves the firm from
  // the credential — so any other surface or tenancy root is a route in the wrong place. The two
  // session-path admissions are refused beside them: the lane never reaches the code that reads them.
  if (
    meta.guestLane !== undefined &&
    (meta.authenticated ||
      meta.permission !== null ||
      meta.surface !== "app" ||
      meta.resource !== "firm" ||
      meta.firmlessSession !== undefined ||
      meta.firmDatabaseOutage !== undefined)
  ) {
    throw new TypeError(
      `Route ${JSON.stringify(meta.operationId)} declares guestLane ${JSON.stringify(meta.guestLane)} ` +
        `but a guest route must be authenticated: false, permission: null, surface: "app" and ` +
        `resource: "firm", with no firmlessSession or firmDatabaseOutage — a guest holds no session ` +
        `and no capability, so the route can claim nothing a session would carry.`,
    );
  }

  // #6 An outside signer's lane is held to the guest lane's terms, for the guest lane's reasons, and
  // a route may ride one lane or the other but never both.
  if (
    meta.signerLane !== undefined &&
    (meta.authenticated ||
      meta.permission !== null ||
      meta.surface !== "app" ||
      meta.resource !== "firm" ||
      meta.guestLane !== undefined ||
      meta.firmlessSession !== undefined ||
      meta.firmDatabaseOutage !== undefined)
  ) {
    throw new TypeError(
      `Route ${JSON.stringify(meta.operationId)} declares signerLane but a signer route must be ` +
        `authenticated: false, permission: null, surface: "app" and resource: "firm", with no ` +
        `guestLane, firmlessSession or firmDatabaseOutage — a signer holds no session and no capability.`,
    );
  }

  const namespace = meta.operationId.slice(0, meta.operationId.indexOf("."));
  const resolvedMeta: ResolvedRouteMeta = {
    ...meta,
    tags: meta.tags?.length ? meta.tags : [namespace],
    deprecated: meta.deprecated ?? false,
    firmlessSession: meta.firmlessSession ?? "reject",
  };
  const documentedConfig =
    meta.idempotency === "required"
      ? withRequiredIdempotencyKeyHeaderDocumentation(routeConfig, meta.operationId)
      : routeConfig;
  const route = createRoute({
    ...documentedConfig,
    operationId: resolvedMeta.operationId,
    tags: resolvedMeta.tags,
    ...(resolvedMeta.deprecated ? { deprecated: true } : {}),
    "x-mc-operationId": resolvedMeta.operationId,
    "x-mc-surface": resolvedMeta.surface,
    "x-mc-authenticated": resolvedMeta.authenticated,
    "x-mc-permission": resolvedMeta.permission,
    "x-mc-resource": resolvedMeta.resource,
    "x-mc-audited": resolvedMeta.audited,
    "x-mc-idempotency": resolvedMeta.idempotency,
    "x-mc-rateLimit": resolvedMeta.rateLimit,
    // Emitted because it is the admission rule for the routes an account with no firm may reach,
    // and on those it stands where a permission would: every permission is firm-scoped, so a
    // firmless caller has none to name. A reader of the contract that could not see this would
    // find an authenticated mutation naming no permission and no reason.
    ...(resolvedMeta.firmlessSession === undefined
      ? {}
      : { "x-mc-firmlessSession": resolvedMeta.firmlessSession }),
    // Emitted because the UI reads it rather than restating it: a dialog's recoverability line and
    // an undo stack's decision to offer a step are both this fact, and a copy of it in a Svelte file
    // is a copy that drifts the first time the route gains a restore.
    ...(resolvedMeta.reversal === undefined ? {} : { "x-mc-reversal": resolvedMeta.reversal }),
    // Emitted because it stands where a permission would on the few routes that carry it: a reader
    // of the contract that could not see it would find an anonymous route serving firm data.
    ...(resolvedMeta.guestLane === undefined ? {} : { "x-mc-guestLane": resolvedMeta.guestLane }),
    ...(resolvedMeta.signerLane === undefined
      ? {}
      : { "x-mc-signerLane": resolvedMeta.signerLane }),
    "x-mc-tags": resolvedMeta.tags,
    "x-mc-deprecated": resolvedMeta.deprecated,
  });
  routeMetaByRoute.set(route, resolvedMeta);
  return route;
}
