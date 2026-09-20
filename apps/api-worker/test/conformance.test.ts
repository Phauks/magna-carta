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
  nonJsonRequestBodyMediaTypes,
  type RouteMeta,
} from "../src/contracts/route-meta.ts";
import {
  reversalDeclarationProblem,
  reversalOperationId,
  type RouteReversal,
} from "../src/contracts/reversal.ts";
import { NON_MUTATING_POST_ALLOW_LIST } from "./support/non-mutating-post-allow-list.ts";

// The route sources, inlined at build time, for the raw-body source scan below. Declared here on the
// same pattern the billing fitness scans use (see billing-freeze-fitness.test.ts).
declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: string; import: string; eager: true },
    ): Record<string, string>;
  }
}

const ROUTE_SOURCES = import.meta.glob("../src/routes/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

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
  "registrations.start":
    "The front door: a visitor with no account asks to join, so no session can exist. Writes one control-plane registration row and sends one email — no firm, no bucket, no key. Every outcome answers identically so the endpoint cannot be used to test which addresses have accounts; IP-keyed rate limiting is the enforcement the chokepoint still applies.",
  "registrations.confirm":
    "Presents the emailed confirmation token, which is itself the only credential the caller can hold at this point — a session would require the account this confirms into existence. Unknown, spent and expired tokens answer one identical refusal.",
  "invitations.redeem":
    "Redeemed by someone who has no account yet, which is the point of an invitation. The code plus the invitee's surname and date of birth are the credential; every unsuccessful combination answers one identical refusal, and the invitation spends its own attempt budget beside the IP-keyed one.",
};

// Subsystems whose every MUTATING route must be idempotency: required (money/trust/payment/
// outbound-comms). Each such slice adds its operationId namespace here as it builds; the payments
// and comms rows land with their slices.
const MONEY_NAMESPACES = new Set<string>(["trust", "billing", "communications"]);

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
    // A FIRMLESS-only route is the one authenticated shape that cannot name a permission, and the
    // exemption is structural rather than a concession. Every permission in the registry is granted
    // through a per-firm role or direct grant, so a caller who has no firm holds none of them by
    // construction: naming one here would be naming a key that route's caller can never hold, which
    // is a permanent 403 rather than a control. `firmlessSession: "only"` is what the chokepoint
    // enforces instead — the route is reachable ONLY by a session with no firm, which is a narrower
    // admission than any permission would be. The audit requirement above still binds, and does the
    // work: these routes are how an account acquires a firm, and each one is recorded.
    if (
      operation["x-mc-authenticated"] === true &&
      operation["x-mc-permission"] == null &&
      operation["x-mc-firmlessSession"] !== "only"
    ) {
      violations.push(
        `${label}: authenticated mutating route must name a non-null x-mc-permission`,
      );
    }
  }
  return violations;
}

/*
 * Every DELETE says what putting it back means, and every declaration that names another operation
 * names one that exists and mutates.
 *
 * The gate starts at DELETE rather than at every mutating method because that is where the question
 * is asked most and was answered least — thirty-three DELETE operations against five reversals of any
 * kind when this landed. `defineOpenAPIRoute` refuses an undeclared DELETE at registration; this is
 * the document-level backstop, and it is also the only place the cross-reference can be checked at
 * all, since a route cannot see the rest of the contract at registration time.
 *
 * A dangling `by` is the failure this exists for: a declaration reading "files.restore puts it back"
 * is worth exactly as much as `files.restore` existing, and a surface that renders the sentence has
 * no way to find out that it does not.
 */
function reversalViolations(document: ReturnType<typeof buildOpenAPIDocument>): string[] {
  const violations: string[] = [];
  const mutatingOperationIds = new Set<string>();
  for (const { method, operation } of operations(document)) {
    if (isMutatingMethod(method)) mutatingOperationIds.add(operationIdOf(operation));
  }
  for (const { path, method, operation } of operations(document)) {
    const label = `${method.toUpperCase()} ${path}`;
    const declared = operation["x-mc-reversal"] as RouteReversal | undefined;
    if (declared === undefined) {
      if (method.toLowerCase() === "delete") {
        violations.push(
          `${label}: a DELETE must declare what putting it back means (x-mc-reversal)`,
        );
      }
      continue;
    }
    const problem = reversalDeclarationProblem(declared);
    if (problem !== undefined) violations.push(`${label}: ${problem}`);
    const named = reversalOperationId(declared);
    if (named !== undefined && named.trim() !== "" && !mutatingOperationIds.has(named)) {
      violations.push(
        `${label}: reversal names ${JSON.stringify(named)}, which is not a mutating operation in this contract`,
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
// landed (slice 1·1's files/matters/locations). It stays a guard, not a suppression: a namespace maps
// to a CLOSED set of allowed resources — almost always exactly one — so a route naming a permission
// from an unrelated subsystem still fails. A new permission subsystem adds its row here; widening a
// row to a second resource is the deliberate revisit the original single-value rule anticipated, and
// is warranted only when the subsystem genuinely governs objects rooted in two places (emails, whose
// per-matter addresses are matter-rooted while the firm catch-all has no matter at all). Never delete
// the check.
const RESOURCE_BY_PERMISSION_NAMESPACE: Record<string, string | readonly string[]> = {
  firm: "firm",
  matters: "matter",
  locations: "location",
  files: "matter",
  directory: "directoryEntity",
  // conflicts:* governs the firm-wide conflicts-of-interest check and its log; every conflicts route
  // operates on the firm as its tenancy root (the search spans the whole firm's directory corpus).
  conflicts: "firm",
  // esign:* governs the platform seal applied to a document; the seal route operates on the firm as
  // its tenancy root (the platform signing identity is firm-agnostic, the audit lands in the firm).
  esign: "firm",
  shipping: "firm",
  tools: "firm",
  // custody:* governs the register of physical client originals a firm holds. It binds the FIRM
  // rather than the matter — a deliberate call against the files:* precedent: a custody packet may
  // have no matter at all by construction (a will held for a client whose last matter closed eleven
  // years ago is the steady state, not an edge case), so binding to "matter" would name a resource
  // half the rows do not have. Same reasoning as the firm catch-all exception in the emails:* row.
  custody: "firm",
  // communications:* governs the log of calls and texts. It binds the FIRM rather than the matter,
  // on the custody row's reasoning immediately above and for the identical structural reason: a
  // communication's matter is nullable by construction — an inbound text from a number nobody
  // recognises belongs to no matter until somebody files it — so binding to "matter" would name a
  // resource the rows in the queue do not have. The matter-scoped read still composes the
  // visible-matter predicate; the binding decides which root the chokepoint resolves.
  communications: "firm",
  // meetings:* governs the room a member opens on a calendar event. It binds the FIRM on the
  // communications:* reasoning immediately above and for the identical structural reason: a meeting
  // hangs from an event, and a FIRM event belongs to no matter at all — a staff meeting is real firm
  // work on no client file — so a matter cannot be the tenancy root of a record that need not have
  // one. The matter question is still asked: every read composes the visible-matter predicate, which
  // is what makes a walled matter's event unreachable.
  meetings: "firm",
  // customFields:* governs firm-defined fields on matter/entity records; its routes carry the
  // matter resource (the nearest tenancy root — custom fields extend matter/entity records).
  customFields: "matter",
  // notes:* governs matter notes — the note, its revisions and its retraction all hang off the
  // matter that owns them, so the namespace binds "matter" exactly as documents:* and files:* do.
  notes: "matter",
  // tasks:* governs work with somebody's name on it. It binds the FIRM and NOT the matter, which is
  // the deliberate contrast with notes:* directly above and the one thing to read before copying
  // that row. A task's matter is NULLABLE — renewing the malpractice policy is real firm work on no
  // client file — so a matter cannot be the tenancy root of a record that need not have one. The
  // matter-scoped list still narrows by matter and still composes the visible-matter predicate;
  // what the binding names is which root the chokepoint resolves, not what a read returns.
  tasks: "firm",
  // intake:* governs two things at two roots: the firm's procedures (firm configuration, the
  // matter-plan posture) and one matter's checklist and records, which are that matter's.
  intake: ["firm", "matter"],
  // downloads:* governs a member's own shelf of what the platform produced for them. It binds the
  // FIRM rather than the matter, on the custody:* reasoning: a shelf spans every matter a member
  // bundled or exported from, and an export that ran outside any matter (the Firm Usage report) has
  // none at all, so binding to "matter" would name a resource most rows do not have.
  downloads: "firm",
  // documents:* governs in-app editing of matter-rooted file objects (the same tenancy root files:*
  // carries), so its routes carry the matter resource.
  documents: "matter",
  // time:* governs time entries and the rate engine, all scoped to matters, and the FIRM's own
  // capture policy, which is scoped to no matter at all. The matter resource is the nearest tenancy
  // root for every time-entry mutation and read; the firm resource is the root of the one setting a
  // firm decides once and every capture is then measured by (the increment and the rounding
  // direction). Two roots on the intake:* precedent immediately above, and for the same structural
  // reason: the second half of this namespace operates on a row that has no matter to be rooted in.
  time: ["matter", "firm"],
  // costs:* governs disbursement WIP entries, all scoped to matters; the matter resource is the
  // nearest tenancy root for every cost-entry mutation and read (mirrors the time precedent).
  costs: "matter",
  // support:* governs help-desk access grants on a firm; grants are firm-scoped (the consent
  // anchor is a firm member, the grant row lives in the control-plane firm namespace).
  support: "firm",
  // diagnostics:* is the read-only system-state surface granted only by a diagnostic support session;
  // no firm role holds it. The resource is the firm — the overview is per-firm state.
  diagnostics: "firm",
  // emails:* governs filing email to matters, reading a matter's filed threads, and managing the
  // forward/CC capture addresses. Email links are matter-rooted (the files:* precedent), so almost
  // every emails route carries the matter resource — including the firm-level "already filed" read,
  // which access-filters to the caller's matters in the handler. The firm CATCH-ALL capture address is
  // the deliberate exception: it has no matter by construction (matter_id is null), its tenancy root
  // is the firm, and binding it to "matter" would name a resource it does not have.
  emails: ["matter", "firm"],
  // templates:* governs the firm's assembly-template catalogue. A template carries no matter data —
  // it is an assembly INPUT, not a matter document — so the firm is its tenancy root, which is also
  // why the catalogue lives in its own tables rather than as matter-rooted file rows. The act of
  // ASSEMBLING is matter-rooted and rides documents:assemble instead.
  // search:matter runs one consolidated search across a matter's sections. It names one matter, it
  // cannot run without one, and it never widens past it — searching the whole application is the
  // command palette's job and carries no permission at all.
  search: "matter",
  templates: "firm",
  // trust:* governs the trust account and the client/matter sub-ledger under it. It binds the FIRM
  // rather than the matter, on the custody reasoning rather than the costs one: a trust account is
  // one real bank account belonging to an office, its ledger spans every client and matter the firm
  // holds money for, and the reconciliation that proves it is per ACCOUNT. Every movement names a
  // matter, but the matter is where the money lands, not the resource the capability governs.
  trust: "firm",
  // billing:* governs the firm's own invoices and the money that comes back against them. It binds
  // the FIRM on the trust reasoning: one invoice may bill several of a client's matters, the
  // receivable it posts is the firm's asset, and the account-role map it resolves through is the
  // firm's chart of accounts. Every line names a matter, but the matter is what is billed, not the
  // resource the capability governs.
  billing: "firm",
  // calendar:* governs litigation events, deadlines, and the matter timeline that federates them
  // with everything else the firm recorded. It binds BOTH resources, on the emails:* reasoning: an
  // event and a deadline always name a matter, so those routes carry the matter resource, while the
  // firm-wide calendar, the deadline list across every matter, and the event-type catalog have no
  // single matter by construction — each is a matter-scoped read repeated under one visibility
  // predicate, and the catalog is firm configuration with no matter at all.
  calendar: ["matter", "firm"],
  // matterAssets:* governs the register of what a client or an estate owns. It binds the MATTER —
  // the clean contrast with custody:*'s firm binding, and the reason is structural rather than
  // stylistic: a custody packet may have no matter at all by construction, while an asset row IS one
  // matter's assertion about one thing owned and cannot exist without a matter. The firm arm covers
  // the two configuration reads that have no single matter by construction: the per-firm type
  // catalog and the platform class registry, which are firm configuration in the same sense the
  // event-type catalog is.
  matterAssets: ["matter", "firm"],
  // magnus:* governs the conversational assistant. It binds the FIRM, on the custody reasoning rather
  // than the matterAssets one: a conversation may carry an optional matter link, but it exists
  // perfectly well without one — a member asking a general question is the ordinary case, not an edge
  // case — so binding to "matter" would name a resource most rows do not have. The link answers which
  // matter's file a transcript belongs to; it is not the resource the capability governs, and it puts
  // none of that matter's content into anything the assistant is sent.
  magnus: "firm",
  // discovery:* governs the corpus of documents under review. It binds the MATTER, on the
  // matterAssets reasoning rather than custody:*'s: a review set IS one matter's corpus and cannot
  // exist without one, where a custody packet may have no matter at all by construction. The
  // namespace being separate from matters:* and files:* is the load-bearing part — a review set is
  // reachable from a discovery grant and from nothing else, because material produced by another
  // party may be attorney's-eyes-only under a protective order and matter access must not carry it.
  discovery: "matter",
  // reports:* governs projections over records the firm already holds — read across every matter and
  // client at once. It binds the FIRM, on the trust and billing reasoning rather than the
  // matterAssets one: a firm-wide receivable position, a productivity report over every timekeeper,
  // and a compliance pack for one trust account are all reads whose tenancy root is the firm. Every
  // figure names matters, but the matter is what is being reported on, not the resource the
  // capability governs.
  reports: "firm",
  // notifications:* governs a member's own feed of things the platform noticed. It binds the FIRM,
  // on the custody/magnus reasoning: a feed spans every matter a member touches AND firm-scoped
  // kinds that have no matter at all — an incident filed against the firm, a trust posting whose
  // entry belongs to the firm's own chart of accounts — so binding it to "matter" would name a
  // resource half the rows do not have. The matter each row DOES name is the visibility anchor the
  // read filters on, not the resource the capability governs.
  notifications: "firm",
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
    const binding = RESOURCE_BY_PERMISSION_NAMESPACE[namespace];
    if (binding === undefined) {
      violations.push(
        `${label}: permission namespace "${namespace}" has no RESOURCE_BY_PERMISSION_NAMESPACE binding`,
      );
      continue;
    }
    const allowedResources = typeof binding === "string" ? [binding] : binding;
    if (typeof resource !== "string" || !allowedResources.includes(resource)) {
      violations.push(
        `${label}: permission namespace "${namespace}" must bind to x-mc-resource ${allowedResources
          .map((allowed) => `"${allowed}"`)
          .join(" or ")}, got "${String(resource)}"`,
      );
    }
  }
  return violations;
}

// Rule: every MUTATING route in a money/trust/payment/comms subsystem declares idempotency: required.
// A retried mutation that posted twice would be a second real movement of somebody's money, which is
// what the gate exists to stop. A read in the same subsystem moves nothing, and an Idempotency-Key on
// a GET is a key with no write to deduplicate — so the rule binds to the methods that can move money,
// not to the namespace wholesale.
function moneyIdempotencyViolations(
  document: ReturnType<typeof buildOpenAPIDocument>,
  moneyNamespaces: ReadonlySet<string>,
): string[] {
  const violations: string[] = [];
  for (const { path, method, operation, namespace } of operations(document)) {
    if (!moneyNamespaces.has(namespace)) continue;
    if (!isMutatingMethod(method)) continue;
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

// Rule: no operation with a non-JSON request body declares idempotency: required.
//
// The chokepoint's required-idempotency gate fingerprints a request by reading its body through Hono's
// body cache, which caches the DECODED TEXT. Bytes that are not valid UTF-8 do not survive that round
// trip, so a raw-bytes body on a required-idempotency route reaches the handler mangled — and a handler
// that stores it as the firm's verbatim original stores a corrupted copy that hashes to nothing.
// defineOpenAPIRoute refuses the combination at registration time; this is the document-level backstop
// (a hand-edited snapshot, or a route not built through the wrapper), and it applies the same media-type
// rule the guard applies rather than a second copy of it.
function binaryBodyIdempotencyViolations(
  document: ReturnType<typeof buildOpenAPIDocument>,
): string[] {
  const violations: string[] = [];
  for (const { path, method, operation } of operations(document)) {
    if (operation["x-mc-idempotency"] !== "required") continue;
    const body = operation.requestBody as { content?: Record<string, unknown> } | undefined;
    const nonJson = nonJsonRequestBodyMediaTypes({ request: { body } });
    if (nonJson.length > 0) {
      violations.push(
        `${method.toUpperCase()} ${path}: x-mc-idempotency "required" with the non-JSON request body media type(s) ${nonJson.join(", ")} — the gate's fingerprint would mangle those bytes; declare "optional" and key the effect in the handler`,
      );
    }
  }
  return violations;
}

// The companion source scan, closing the blind spot the document rule cannot see: a route that reads
// the request body as RAW BYTES without declaring a request body at all. Every committed route that
// streams bytes now declares its application/octet-stream body, so the document rule covers them all
// today — but a route authored without that declaration emits no media type, the rule above would not
// notice it flipping to "required", and the corruption would be identical. Not every raw-bytes reader
// is even in the document (the dev-only R2 upload emulator is a bare app.put), which is why this prong
// reads source rather than the contract. Granularity is the route MODULE: a module that reads a
// request body raw must not also declare idempotency: "required", because the two cannot be paired
// safely and a module doing both deserves a human deciding which route is which.
const RAW_REQUEST_BODY_READ_PATTERN =
  /\b(?:c|context)\.req\.(?:raw\.body|arrayBuffer\(\)|blob\(\)|bytes\(\)|formData\(\))/;
const REQUIRED_IDEMPOTENCY_DECLARATION = /idempotency:\s*"required"/;
// The escape hatch, matching the marker convention the billing fitness scans use: a module that
// legitimately pairs a raw-bytes route with an unrelated required-idempotency route marks itself, and
// the marker is the record that a human made that call.
const RAW_BODY_ALLOW_MARKER = "fitness:allow-raw-body-with-required-idempotency";

function rawBodyModuleIdempotencyViolations(sources: Record<string, string>): string[] {
  const violations: string[] = [];
  for (const [path, source] of Object.entries(sources)) {
    if (source.includes(RAW_BODY_ALLOW_MARKER)) continue;
    if (!RAW_REQUEST_BODY_READ_PATTERN.test(source)) continue;
    if (!REQUIRED_IDEMPOTENCY_DECLARATION.test(source)) continue;
    violations.push(
      `${path}: reads the request body as raw bytes AND declares idempotency: "required" — the required-idempotency gate's fingerprint decodes the body as text, so those bytes would reach the handler mangled`,
    );
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

// Rule: every operation declares a success response, and a WebSocket subscribe endpoint's 101 counts
// as one. This is Spectral's `operation-success-response` moved here (see .spectral.yaml): a subscribe
// endpoint's only success IS the 101, Spectral's base rule only recognises 2xx/3xx, and its
// per-operation overrides do not take effect for that rule. Expressed here it also says the stronger
// thing Spectral could not: an operation that declares 101 must not ALSO claim a 2xx, because a route
// that upgrades has no body-bearing success to describe.
function successResponseViolations(document: ReturnType<typeof buildOpenAPIDocument>): string[] {
  const violations: string[] = [];
  for (const { path, method, operation } of operations(document)) {
    const label = `${method.toUpperCase()} ${path}`;
    const statuses = Object.keys(
      (operation as { responses?: Record<string, unknown> }).responses ?? {},
    );
    const upgrades = statuses.includes("101");
    const successes = statuses.filter((status) => Number(status) >= 200 && Number(status) < 400);
    if (!upgrades && successes.length === 0) {
      violations.push(`${label}: declares no success response (2xx/3xx, or 101 for an upgrade)`);
    }
    if (upgrades && successes.length > 0) {
      violations.push(
        `${label}: declares 101 (an upgrade) alongside ${successes.join(", ")} — an upgrade has no ` +
          `body-bearing success to describe`,
      );
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
  });
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
    const ids = [...operations(document)].map((entry) => entry.operationId).toSorted();
    expect(ids).toEqual([
      "aiDetection.detect",
      "assemblies.status",
      "assemblies.submit",
      "billing.accountRoles",
      "billing.addClaims",
      "billing.addContingencyFee",
      "billing.addFlatFee",
      "billing.applyClientCredit",
      "billing.applyTrustFunds",
      "billing.approveTrustApplication",
      "billing.arrangement",
      "billing.clientCredits",
      "billing.contingencyResidual",
      "billing.createInvoice",
      "billing.finalizeInvoice",
      "billing.invoiceDetail",
      "billing.invoiceRenderModel",
      "billing.issueCreditNote",
      "billing.listCreditNotes",
      "billing.listDeliveries",
      "billing.listInvoices",
      "billing.listRecoveries",
      "billing.matterUnbilled",
      "billing.receivablesAging",
      "billing.recordDelivery",
      "billing.recordRecovery",
      "billing.releaseClaim",
      "billing.renderShapeDefault",
      "billing.requestReplenishment",
      "billing.resolveReplenishment",
      "billing.retainerStatus",
      "billing.reverseApplication",
      "billing.setAccountRoles",
      "billing.setArrangement",
      "billing.setRenderShapeDefault",
      "billing.submitTrustApplication",
      "billing.updateLine",
      "billing.voidDraft",
      "billing.voidRecovery",
      "billing.writeOffBalance",
      "calendar.cancelEvent",
      "calendar.cancelFirmEvent",
      "calendar.continuanceChain",
      "calendar.continueEvent",
      "calendar.createBooking",
      "calendar.createDeadline",
      "calendar.createEvent",
      "calendar.createEventLink",
      "calendar.createEventType",
      "calendar.createFirmEvent",
      "calendar.createResource",
      "calendar.deactivateEventType",
      "calendar.deleteBooking",
      "calendar.deleteEventLink",
      "calendar.firmCalendar",
      "calendar.getEvent",
      "calendar.getFirmEvent",
      "calendar.getSettings",
      "calendar.listDeadlines",
      "calendar.listEventBookings",
      "calendar.listEventLinks",
      "calendar.listEventTypes",
      "calendar.listEvents",
      "calendar.listFirmEventBookings",
      "calendar.listFirmEventLinks",
      "calendar.listFirmEvents",
      "calendar.listResources",
      "calendar.matterTimeline",
      "calendar.resourceAvailability",
      "calendar.satisfyDeadline",
      "calendar.supersedeDeadline",
      "calendar.updateBooking",
      "calendar.updateDeadline",
      "calendar.updateEvent",
      "calendar.updateEventType",
      "calendar.updateFirmEvent",
      "calendar.updateResource",
      "calendar.updateSettings",
      "calendar.vacateDeadline",
      "communications.clearDisposition",
      "communications.get",
      "communications.list",
      "communications.listForMatter",
      "communications.log",
      "communications.nextNumber",
      "communications.routeToMatter",
      "communications.setDisposition",
      "communications.unrouteFromMatter",
      "communications.unroutedCount",
      "communications.update",
      "conflicts.fileCheckOnMatter",
      "conflicts.firmPolicy",
      "conflicts.getCheck",
      "conflicts.hitDispositions",
      "conflicts.listChecks",
      "conflicts.matterPosture",
      "conflicts.nextCheckNumber",
      "conflicts.recheckMatter",
      "conflicts.recordDisposition",
      "conflicts.rerunCheck",
      "conflicts.runCheck",
      "conflicts.setFirmPolicy",
      "conversions.events",
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
      "custody.addItem",
      "custody.addOwner",
      "custody.approveDestructionRequest",
      "custody.closeStocktake",
      "custody.completeReview",
      "custody.createItemType",
      "custody.createLocation",
      "custody.createPacket",
      "custody.deactivateItemType",
      "custody.executeDestructionRequest",
      "custody.getPacket",
      "custody.getStocktake",
      "custody.linkScan",
      "custody.listDestructionRequests",
      "custody.listItemTypes",
      "custody.listLocations",
      "custody.listMovements",
      "custody.listOverdue",
      "custody.listPackets",
      "custody.listReminders",
      "custody.listSightings",
      "custody.listStocktakes",
      "custody.openStocktake",
      "custody.placeHold",
      "custody.raiseDestructionRequest",
      "custody.recordMovement",
      "custody.recordSightings",
      "custody.refuseDestructionRequest",
      "custody.releaseHold",
      "custody.renderLabels",
      "custody.reportHoldingsByLocation",
      "custody.reportHoldingsByOwner",
      "custody.reportHolds",
      "custody.stocktakeReconciliation",
      "custody.updateItem",
      "custody.updateLocation",
      "custody.updatePacket",
      "custody.willDepositDuties",
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
      "decryption.recoverCancel",
      "decryption.recoverStart",
      "decryption.recoverStatus",
      "decryption.unlock",
      "directory.addAddress",
      "directory.addEmail",
      "directory.addIdentifier",
      "directory.addName",
      "directory.addPhone",
      "directory.assignCategory",
      "directory.changeName",
      "directory.contactPoints",
      "directory.createCategory",
      "directory.createEdge",
      "directory.createOrganization",
      "directory.createPerson",
      "directory.duplicateCandidates",
      "directory.entityNames",
      "directory.getOrganization",
      "directory.getPerson",
      "directory.linkMatterParty",

      "directory.listAddresses",
      "directory.listCategories",
      "directory.listEdges",
      "directory.listEmails",
      "directory.listEntities",
      "directory.listEntityCategories",
      "directory.listEntityMatterParties",
      "directory.listIdentifiers",
      "directory.listMatterParties",
      "directory.listNames",
      "directory.listPhones",
      "directory.merge",
      "directory.readIdentifier",
      "directory.removeAddress",
      "directory.removeEmail",
      "directory.removePhone",
      "directory.search",
      "directory.setPersonLifeDates",
      "directory.setPersonPronouns",
      "directory.unlinkMatterParty",
      "directory.updateAddress",
      "directory.updateEmail",
      "directory.updatePhone",
      "discovery.applyCoding",
      "discovery.bulkCoding",
      "discovery.createCodingQuestion",
      "discovery.createCodingTag",
      "discovery.createRecordCustodian",
      "discovery.createReviewSet",
      "discovery.declareLoad",
      "discovery.downloadLoadArtifact",
      "discovery.getCodingHistory",
      "discovery.getCodingPanel",
      "discovery.getCodingProgress",
      "discovery.getDocumentCoding",
      "discovery.getLoad",
      "discovery.getReviewDocument",
      "discovery.getReviewDocumentText",
      "discovery.getReviewSet",
      "discovery.getReviewSetAccess",
      "discovery.getReviewSetIndexStatus",
      "discovery.grantReviewSetAccess",
      "discovery.listAllReviewSets",
      "discovery.listLoads",
      "discovery.listRecordCustodians",
      "discovery.listReviewDocumentOccurrences",
      "discovery.listReviewDocuments",
      "discovery.listReviewSetExceptions",
      "discovery.listReviewSets",
      "discovery.revokeReviewSetAccess",
      "discovery.runInternalLoad",
      "discovery.transitionReviewSet",
      "discovery.undoCodingAct",
      "discovery.updateCodingQuestion",
      "discovery.updateCodingTag",
      "discovery.updateRecordCustodian",
      "discovery.updateReviewSet",
      "documentTypes.create",
      "documentTypes.deactivate",
      "documentTypes.list",
      "documentTypes.update",
      "documents.checkin",
      "documents.checkout",
      "documents.editOpenProgress",
      "documents.editSession",
      "documents.forceRelease",
      "documents.reconcile",
      "documents.viewSession",
      "downloadPreferences.get",
      "downloadPreferences.update",
      "downloads.bundleEvents",
      "downloads.bundleStatus",
      "downloads.fetch",
      "downloads.recordSnapshot",
      "downloads.remove",
      "downloads.shelf",
      "downloads.zip",
      "editingPolicy.get",
      "editingPolicy.update",
      "emailInspector.inspect",
      "emails.accept",
      "emails.alreadyFiled",
      "emails.autoFileDecisions",
      "emails.autoFileReview",
      "emails.captureStatus",
      "emails.createAutoFileRule",
      "emails.file",
      "emails.filingContext",
      "emails.get",
      "emails.getAutoFilePolicy",
      "emails.list",
      "emails.listAutoFileRules",
      "emails.listCaptureAddresses",
      "emails.mintCaptureAddress",
      "emails.mintFirmCaptureAddress",
      "emails.resumeAutoFileRule",
      "emails.revokeAutoFileRule",
      "emails.revokeCaptureAddress",
      "emails.revokeFirmCaptureAddress",
      "emails.rotateCaptureAddress",
      "emails.suggestMatters",
      "emails.suspendAutoFileRule",
      "emails.unlink",
      "emails.updateAutoFilePolicy",
      "emails.updateAutoFileRule",
      "esign.seal",
      "fees.approve",
      "fees.create",
      "fees.deleteDraft",
      "fees.get",
      "fees.kickBack",
      "fees.list",
      "fees.submit",
      "fees.update",
      "fees.void",
      "fileIntegrity.hash",
      "fileIntegrity.verify",
      "fileRepair.carve",
      "fileRepair.carveAttach",
      "fileRepair.diagnose",
      "fileRepair.repair",
      "fileRepair.repairAttach",
      "fileType.verify",
      "files.archiveEntries",
      "files.delete",
      "files.download",
      "files.extractArchiveMembers",
      "files.get",
      "files.history",
      "files.list",
      "files.listDeleted",
      "files.preview",
      "files.rescan",
      "files.restore",
      "files.scans",
      "files.update",
      "files.versions",
      "firm.setReleaseChannel",
      "firmAiSettings.get",
      "firmAiSettings.update",
      "firmNotificationPolicy.get",
      "firmNotificationPolicy.update",
      "firmProfile.getBrandImageContent",
      "firmProfile.listBrandImages",
      "firmProfile.removeBrandImage",
      "firmProfile.set",
      "firmProfile.setBrandImage",
      "firmProfile.updateBrandImage",
      "firmReportPolicy.get",
      "firmReportPolicy.update",
      "firmTimePolicy.get",
      "firmTimePolicy.update",
      "firmUsage.get",
      "firms.provision",
      "folders.create",
      "folders.delete",
      "folders.list",
      "folders.update",
      "health.read",
      "incidents.report",
      "intake.addStep",
      "intake.createProcedure",
      "intake.editProcedure",
      "intake.editStep",
      "intake.listConsultations",
      "intake.listProcedures",
      "intake.readChecklist",
      "intake.readProcedure",
      "intake.recordStep",
      "intake.reopenStep",
      "intake.retireStep",
      "intake.setProcedureActive",
      "intake.waiveStep",
      "invitations.issue",
      "invitations.redeem",
      "locations.addMember",
      "locations.assignMember",
      "locations.clearLetterheadLogo",
      "locations.close",
      "locations.create",
      "locations.get",
      "locations.getLetterheadLogo",
      "locations.list",
      "locations.removeMember",
      "locations.setAddresses",
      "locations.setFirmDefault",
      "locations.setLetterheadLogo",
      "locations.update",
      "magnus.acknowledge",
      "magnus.attachFile",
      "magnus.availability",
      "magnus.deleteConversation",
      "magnus.detachFile",
      "magnus.events",
      "magnus.getConversation",
      "magnus.getTurn",
      "magnus.listConversations",
      "magnus.moveConversation",
      "magnus.renameConversation",
      "magnus.startConversation",
      "magnus.submitTurn",
      "matterAssets.addInterest",
      "matterAssets.appendValuation",
      "matterAssets.createAsset",
      "matterAssets.createAssetBatch",
      "matterAssets.createAssetType",
      "matterAssets.deleteAsset",
      "matterAssets.endInterest",
      "matterAssets.getAsset",
      "matterAssets.linkDocument",
      "matterAssets.listAssetClasses",
      "matterAssets.listAssetTypes",
      "matterAssets.listAssets",
      "matterAssets.listValuations",
      "matterAssets.readAssetSchedule",
      "matterAssets.readIdentifierValue",
      "matterAssets.recordEncumbrance",
      "matterAssets.recordIdentifier",
      "matterAssets.releaseEncumbrance",
      "matterAssets.unlinkDocument",
      "matterAssets.updateAsset",
      "matterPlans.accept",
      "matterPlans.addPlanStep",
      "matterPlans.createPlan",
      "matterPlans.editPlan",
      "matterPlans.editPlanStep",
      "matterPlans.listOffered",
      "matterPlans.listPlans",
      "matterPlans.propose",
      "matterPlans.readPlan",
      "matterPlans.removePlanStep",
      "matterPlans.setPlanActive",
      "matterSearch.search",
      "matterTypes.create",
      "matterTypes.deactivate",
      "matterTypes.list",
      "matterTypes.update",
      "matters.close",
      "matters.closeReadiness",
      "matters.courtCase",
      "matters.create",
      "matters.createAssignment",
      "matters.endAssignment",
      "matters.estate",
      "matters.get",
      "matters.graduate",
      "matters.graduateReadiness",
      "matters.hold",
      "matters.list",
      "matters.listAssignments",
      "matters.listConsultations",
      "matters.open",
      "matters.openReadiness",
      "matters.release",
      "matters.renumber",
      "matters.reopen",
      "matters.setCourtCase",
      "matters.setEstate",
      "matters.update",
      "me.get",
      "me.name",
      "me.setName",
      "meetings.attendance",
      "meetings.end",
      "meetings.get",
      "meetings.getForEvent",
      "meetings.getForFirmEvent",
      "meetings.grantHosting",
      "meetings.hosts",
      "meetings.join",
      "meetings.leave",
      "meetings.list",
      "meetings.listMessages",
      "meetings.redactMessage",
      "meetings.removeParticipant",
      "meetings.revokeHosting",
      "meetings.sendMessage",
      "meetings.setLocked",
      "meetings.socket",
      "meetings.start",
      "members.deactivate",
      "members.invite",
      "members.list",
      "members.professionalProfile",
      "members.reactivate",
      "members.setProfessionalProfile",
      "members.setRoles",
      "meta.databaseHealth",
      "meta.versions",
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
      "notes.attachNoteDocument",
      "notes.createNote",
      "notes.deleteNote",
      "notes.detachNoteDocument",
      "notes.editNote",
      "notes.getNote",
      "notes.listNotes",
      "notificationPreferences.get",
      "notificationPreferences.getTrustComplianceRecipients",
      "notificationPreferences.setTrustComplianceRecipients",
      "notificationPreferences.update",
      "notifications.dismiss",
      "notifications.list",
      "notifications.markAllRead",
      "notifications.markRead",
      "notifications.unreadCount",
      "numbering.get",
      "numbering.list",
      "numbering.preview",
      "numbering.set",
      "ocr.recognize",
      "ocr.searchable",
      "onboarding.foundFirm",
      "onboarding.redeemInvitation",
      "platform.setFirmReleaseChannel",
      "platformStatus.clearComponentOverride",
      "platformStatus.declareEvent",
      "platformStatus.postUpdate",
      "platformStatus.resolveEvent",
      "platformStatus.setComponentOverride",
      "rateCards.create",
      "rateCards.list",
      "rates.append",
      "rates.reRateDrafts",
      "registrations.confirm",
      "registrations.start",
      "reports.exportRender",
      "reports.trustCompliancePack",
      "roles.list",
      "safeBrowse.post",
      "safeBrowse.sessionProbe",
      "safeBrowse.stream",
      "scan.diagnose",
      "scan.matter",
      "scanPolicy.get",
      "scanPolicy.scoreHistogram",
      "scanPolicy.update",
      "shipping.connect",
      "shipping.createShipment",
      "shipping.disconnectCarrier",
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
      "tasks.archiveTask",
      "tasks.attachTaskDocument",
      "tasks.createTask",
      "tasks.deleteTask",
      "tasks.detachTaskDocument",
      "tasks.editTask",
      "tasks.linkExternalTask",
      "tasks.listMatterTasks",
      "tasks.listMyTasks",
      "tasks.lookupExternalTask",
      "tasks.moveTask",
      "tasks.readTaskChanges",
      "tasks.reassignTask",
      "tasks.recordExternalSync",
      "tasks.unarchiveTask",
      "tasks.unlinkExternalTask",
      "templates.addVersion",
      "templates.archive",
      "templates.deleteFieldMapping",
      "templates.fieldMappings",
      "templates.fields",
      "templates.list",
      "templates.mergeFields",
      "templates.register",
      "templates.upload",
      "timeEntries.approve",
      "timeEntries.attachFile",
      "timeEntries.convertToCost",
      "timeEntries.create",
      "timeEntries.detachFile",
      "timeEntries.events",
      "timeEntries.get",
      "timeEntries.gridBatch",
      "timeEntries.kickBack",
      "timeEntries.list",
      "timeEntries.listAttachments",
      "timeEntries.previewQuickAdd",
      "timeEntries.refile",
      "timeEntries.roundingPolicy",
      "timeEntries.submit",
      "timeEntries.unvoid",
      "timeEntries.update",
      "timeEntries.void",
      "timer.bind",
      "timer.discard",
      "timer.pause",
      "timer.read",
      "timer.resume",
      "timer.start",
      "timer.stopCommit",
      "toolsConnection.get",
      "toolsTurnCredentials.get",
      "trust.approveDisbursement",
      "trust.bankStatementLines",
      "trust.changeAuthorizationPolicy",
      "trust.closeReconciliation",
      "trust.closeUnclaimedFundsReview",
      "trust.deposit",
      "trust.depositFirmFunds",
      "trust.dormantBalances",
      "trust.firmFundsPosition",
      "trust.getReconciliation",
      "trust.getUnclaimedFundsReview",
      "trust.importBankStatement",
      "trust.listBankStatements",
      "trust.listDisbursementRequests",
      "trust.listReconciliations",
      "trust.listTrustAccounts",
      "trust.matterLedger",
      "trust.openFirmFunds",
      "trust.openReconciliation",
      "trust.openUnclaimedFundsReview",
      "trust.previewStatementImport",
      "trust.readAuthorizationPolicy",
      "trust.reconciliationSuggestions",
      "trust.recordBankCharge",
      "trust.recordBankStatement",
      "trust.recordReconciliationMatch",
      "trust.recordUnclaimedFundsContactAttempt",
      "trust.rejectDisbursement",
      "trust.requestDisbursement",
      "trust.transferBetweenMatters",
      "trust.withdrawDisbursement",
      "trust.withdrawReconciliationMatch",
      "uploadReadiness.check",
      "uploads.abort",
      "uploads.complete",
      "uploads.duplicate",
      "uploads.get",
      "uploads.initiate",
      "uploads.matches",
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

  describe("every DELETE declares what putting it back means", () => {
    it("the committed contract satisfies it", () => {
      expect(reversalViolations(document)).toEqual([]);
    });
    it("flags a DELETE with no declaration (raw — defineOpenAPIRoute guards this at registration)", () => {
      const bad = documentWithOperations([
        {
          method: "delete",
          path: "/api/v1/widgets/{id}",
          operation: rawOperation({
            operationId: "widgets.remove",
            "x-mc-operationId": "widgets.remove",
          }),
        },
      ]);
      expect(reversalViolations(bad).length).toBeGreaterThan(0);
    });
    it("flags a declaration naming an operation the contract does not have", () => {
      const bad = documentWithOperations([
        {
          method: "delete",
          path: "/api/v1/widgets/{id}",
          operation: rawOperation({
            operationId: "widgets.remove",
            "x-mc-operationId": "widgets.remove",
            "x-mc-reversal": { kind: "inverse", by: "widgets.restore" },
          }),
        },
      ]);
      expect(reversalViolations(bad)).toContainEqual(expect.stringContaining("widgets.restore"));
    });
    it("flags a declaration naming an operation that exists but does not mutate", () => {
      const bad = documentWithOperations([
        {
          method: "get",
          path: "/api/v1/widgets",
          operation: rawOperation({
            operationId: "widgets.list",
            "x-mc-operationId": "widgets.list",
          }),
        },
        {
          method: "delete",
          path: "/api/v1/widgets/{id}",
          operation: rawOperation({
            operationId: "widgets.remove",
            "x-mc-operationId": "widgets.remove",
            "x-mc-reversal": { kind: "inverse", by: "widgets.list" },
          }),
        },
      ]);
      expect(reversalViolations(bad).length).toBeGreaterThan(0);
    });
    it("flags a none that carries no reason — the one arm that must say why", () => {
      const bad = documentWithOperations([
        {
          method: "delete",
          path: "/api/v1/widgets/{id}",
          operation: rawOperation({
            operationId: "widgets.remove",
            "x-mc-operationId": "widgets.remove",
            "x-mc-reversal": { kind: "none", reason: "   " },
          }),
        },
      ]);
      expect(reversalViolations(bad).length).toBeGreaterThan(0);
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

  describe("money-subsystem routes require idempotency", () => {
    it("the committed contract satisfies it", () => {
      expect(moneyIdempotencyViolations(document, MONEY_NAMESPACES)).toEqual([]);
    });
    it("no committed money-looking route escaped MONEY_NAMESPACES (the registration safety net)", () => {
      expect(
        moneyRegistrationGapViolations(document, MONEY_SUBSYSTEM_KEYWORDS, MONEY_NAMESPACES),
      ).toEqual([]);
    });
    it("flags a money-looking route that was not registered in MONEY_NAMESPACES", () => {
      // `payments` is a money keyword whose slice has not landed, so it is deliberately not yet in
      // MONEY_NAMESPACES — exactly the state a forgotten registration would leave a namespace in.
      const bad = documentWithOperations([
        {
          method: "post",
          path: "/api/v1/payments",
          operation: rawOperation({ "x-mc-operationId": "payments.charge" }),
        },
      ]);
      expect(
        moneyRegistrationGapViolations(bad, MONEY_SUBSYSTEM_KEYWORDS, MONEY_NAMESPACES).length,
      ).toBeGreaterThan(0);
    });
    it("does not demand an idempotency key on a money-subsystem READ", () => {
      const fine = documentForRoute(
        baseMeta({ operationId: "payments.list", idempotency: "optional" }),
        { method: "get", path: "/api/v1/payments" },
      );
      expect(moneyIdempotencyViolations(fine, new Set(["payments"]))).toEqual([]);
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

  describe("every operation declares a success response (101 counts, and excludes 2xx)", () => {
    it("the committed contract satisfies it", () => {
      expect(successResponseViolations(document)).toEqual([]);
    });

    it("flags an operation with no success response at all", () => {
      const bad = documentWithOperations([
        {
          method: "get",
          path: "/api/v1/widgets",
          operation: rawOperation({ responses: { 404: { description: "Not found" } } }),
        },
      ]);
      expect(successResponseViolations(bad).length).toBeGreaterThan(0);
    });

    it("accepts an upgrade endpoint whose only success is 101", () => {
      const upgrade = documentWithOperations([
        {
          method: "get",
          path: "/api/v1/widgets/events",
          operation: rawOperation({ responses: { 101: { description: "Subscribed" } } }),
        },
      ]);
      expect(successResponseViolations(upgrade)).toEqual([]);
    });

    it("flags an upgrade endpoint that also claims a 2xx", () => {
      const confused = documentWithOperations([
        {
          method: "get",
          path: "/api/v1/widgets/events",
          operation: rawOperation({
            responses: { 101: { description: "Subscribed" }, 200: { description: "OK" } },
          }),
        },
      ]);
      expect(successResponseViolations(confused).length).toBeGreaterThan(0);
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

  describe("a raw-bytes request body never rides the required-idempotency gate", () => {
    it("the committed contract satisfies it", () => {
      expect(binaryBodyIdempotencyViolations(document)).toEqual([]);
    });

    it("is not vacuous — the document really carries both required-idempotency and non-JSON-body routes", () => {
      // Either half missing would make the rule pass trivially: with no required-idempotency route
      // there is nothing to check, and with no octet-stream route the hazard could not arise at all.
      let requiredCount = 0;
      let nonJsonBodyCount = 0;
      for (const { operation } of operations(document)) {
        if (operation["x-mc-idempotency"] === "required") requiredCount += 1;
        const body = operation.requestBody as { content?: Record<string, unknown> } | undefined;
        if (nonJsonRequestBodyMediaTypes({ request: { body } }).length > 0) nonJsonBodyCount += 1;
      }
      expect(requiredCount).toBeGreaterThan(10);
      expect(nonJsonBodyCount).toBeGreaterThan(0);
    });

    it("flags an operation pairing a required-idempotency posture with an octet-stream body", () => {
      const violations = binaryBodyIdempotencyViolations(
        documentWithOperations([
          {
            method: "post",
            path: "/api/v1/widgets",
            operation: rawOperation({
              "x-mc-idempotency": "required",
              requestBody: { content: { "application/octet-stream": { schema: {} } } },
            }),
          },
        ]),
      );
      expect(violations.length).toBe(1);
      expect(violations[0]).toContain("application/octet-stream");
    });

    it("allows a JSON body and the +json structured suffix under required idempotency", () => {
      for (const mediaType of ["application/json", "application/merge-patch+json"]) {
        expect(
          binaryBodyIdempotencyViolations(
            documentWithOperations([
              {
                method: "post",
                path: "/api/v1/widgets",
                operation: rawOperation({
                  "x-mc-idempotency": "required",
                  requestBody: { content: { [mediaType]: { schema: {} } } },
                }),
              },
            ]),
          ),
        ).toEqual([]);
      }
    });

    it("defineOpenAPIRoute refuses the combination at registration time", () => {
      // The document rule above is the backstop; the guard is what makes the hazard unreachable, so a
      // route author gets a startup failure rather than a CI failure after the fact.
      expect(() =>
        defineOpenAPIRoute(baseMeta({ idempotency: "required" }), {
          method: "post",
          path: "/api/v1/widgets",
          description: "A deliberately-constructed route for the conformance negative control.",
          request: {
            headers: z.object({ "idempotency-key": z.string() }),
            body: { content: { "application/octet-stream": { schema: z.any() } } },
          },
          responses: okResponse,
        }),
      ).toThrow(/application\/octet-stream/);
    });

    it("no route module pairs a raw request-body read with a required-idempotency declaration", () => {
      // Non-vacuity floors first: the glob resolved the route modules, and it really sees both a
      // raw-body reader and a required-idempotency declaration among them — otherwise the scan below
      // would be checking an empty intersection of two empty sets.
      const sources: Record<string, string> = ROUTE_SOURCES;
      expect(Object.keys(sources).length).toBeGreaterThan(20);
      const rawBodyModules = Object.keys(sources).filter((key) =>
        RAW_REQUEST_BODY_READ_PATTERN.test(sources[key]!),
      );
      const requiredModules = Object.keys(sources).filter((key) =>
        REQUIRED_IDEMPOTENCY_DECLARATION.test(sources[key]!),
      );
      expect(rawBodyModules.length).toBeGreaterThan(0);
      expect(requiredModules.length).toBeGreaterThan(0);

      expect(rawBodyModuleIdempotencyViolations(sources)).toEqual([]);
    });

    it("flags a module that reads the body raw and declares required idempotency", () => {
      const violations = rawBodyModuleIdempotencyViolations({
        "src/routes/widgets.ts":
          'const meta = { idempotency: "required" };\nconst body = c.req.raw.body;\n',
      });
      expect(violations.length).toBe(1);
      expect(violations[0]).toContain("src/routes/widgets.ts");
    });

    it("honours the allow marker for a module that legitimately carries both", () => {
      expect(
        rawBodyModuleIdempotencyViolations({
          "src/routes/widgets.ts": `// ${RAW_BODY_ALLOW_MARKER}: the raw-bytes route and the keyed route are different routes.\nconst meta = { idempotency: "required" };\nconst body = c.req.raw.body;\n`,
        }),
      ).toEqual([]);
    });
  });

  // THE REPORTING SURFACE IS READ-ONLY, AND IT IS CHECKABLE. The reporting package composes nothing
  // and a fitness function over its sources proves it cannot write; this is the other half of that
  // guarantee, at the route layer. A report that could write would be a report that could adjust the
  // books it is reporting on, and the difference an audit artifact exists to surface would be the
  // difference it quietly removed.
  //
  // The one write the surface will ever have — turning a report into a filed firm record — is the
  // caller's, rides `reports:produce`, and is the single exemption below. Every other reports route
  // is a GET or an allow-listed non-mutating POST (a pure computation the write-method rule cannot
  // tell from a write — reports.exportRender, the export printer, is one), and no `reports:` key may
  // appear on a mutating route in any other namespace either: that is how a future route is stopped
  // from borrowing one. The allow-list is NON_MUTATING_POST_ALLOW_LIST — one declaration of
  // "this POST writes nothing" shared with the audited-mutating rule, so the two cannot disagree
  // about which routes those are.
  describe("the reporting surface is read-only", () => {
    const REPORTS_WRITE_KEY = "reports:produce";

    function reportsWriteViolations(document: ReturnType<typeof buildOpenAPIDocument>): string[] {
      const violations: string[] = [];
      for (const { path, method, operation, operationId } of operations(document)) {
        const permission = operation["x-mc-permission"];
        if (typeof permission !== "string" || !permission.startsWith("reports:")) continue;
        if (!isMutatingMethod(method)) continue;
        if (permission === REPORTS_WRITE_KEY) continue;
        if (operationId in NON_MUTATING_POST_ALLOW_LIST) continue;
        violations.push(
          `${method.toUpperCase()} ${path}: a reports: read key may not gate a mutating route — only ${REPORTS_WRITE_KEY} may, and only on the route that files a produced report`,
        );
      }
      return violations;
    }

    it("the committed contract satisfies it", () => {
      expect(reportsWriteViolations(document)).toEqual([]);
    });

    it("is not vacuous — the document really carries reports routes", () => {
      const reportsOperations = [...operations(document)].filter(
        (entry) => entry.namespace === "reports",
      );
      expect(reportsOperations.length).toBeGreaterThan(0);
      // And every one of them is a GET or a declared non-mutating POST today.
      expect(
        reportsOperations.every(
          (entry) => entry.method === "get" || entry.operationId in NON_MUTATING_POST_ALLOW_LIST,
        ),
      ).toBe(true);
    });

    it("flags a mutating route gated on a reports: read key", () => {
      const bad = documentWithOperations([
        {
          method: "post",
          path: "/api/v1/reports/trust-compliance",
          operation: rawOperation({
            "x-mc-operationId": "reports.write",
            "x-mc-permission": "reports:trustCompliance",
            "x-mc-resource": "firm",
          }),
        },
      ]);
      expect(reportsWriteViolations(bad).length).toBeGreaterThan(0);
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
