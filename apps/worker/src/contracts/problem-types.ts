// The problem-type URI registry: every RFC 9457 `type` URI the API
// emits is a key here (registry-first — stable URIs, one docs page each). A closed union: handing
// problemType() an unregistered key is a compile error, so a new problem type means a new row here.
//
// The value is a SECOND axis from the key, not redundant machinery: the key is the stable internal
// name callers reference (problemType("not-found")), the value is the URI slug emitted in the
// document. Today every value equals its key (the identity-map pin in problem.test.ts holds the
// two in sync), but keeping them separate gives headroom to remap one key to a different URI slug
// later — renaming a public slug without breaking internal callers, or vice versa — without
// collapsing the two roles into one.
export const PROBLEM_TYPES = {
  validation: "validation",
  unauthenticated: "unauthenticated",
  "permission-denied": "permission-denied",
  "not-found": "not-found",
  "idempotency-key-missing": "idempotency-key-missing",
  "idempotency-key-conflict": "idempotency-key-conflict",
  "idempotency-fingerprint-mismatch": "idempotency-fingerprint-mismatch",
  "rate-limited": "rate-limited",
  // A business resource clash (HTTP 409): a firm name already taken, a concurrent provisioning
  // that won the race. DISTINCT from the idempotency-* conflicts (those are key/payload clashes on
  // the idempotency record, not the business resource).
  conflict: "conflict",
  // An email / owner-email uniqueness violation (HTTP 422). A DISTINCT slug from `validation`
  // (which the app-level defaultHook owns for Zod request-shape failures): this is a semantic
  // uniqueness clash surfaced from a committed write, not a request-shape rejection.
  "email-in-use": "email-in-use",
  // An upload the firm's policy refuses (HTTP 422): a size over the cap, a blocked extension, or a
  // disallowed content type — checked at presign against the declared facts and re-checked against
  // the real bytes at the ingest gate. DISTINCT from `validation` (request-shape) — the request is
  // well-formed; the firm policy refuses its content.
  "upload-not-allowed": "upload-not-allowed",
  // A download of a version a re-scan flagged as malware (HTTP 409). Informed access: the file is not
  // hidden, but the raw download is gated until the member acknowledges the risk (acknowledgeMalware).
  "malware-flagged": "malware-flagged",
  // An unsupported format conversion (HTTP 422): the requested from→to format pair has no path in
  // the conversion graph — either the format is unknown or no engine covers the pair. DISTINCT from
  // `validation` (request-shape) — the request is well-formed; the registry has no path.
  "unsupported-conversion": "unsupported-conversion",
  // A decryption attempt that failed because the supplied password did not open the file (HTTP 400).
  // Generic — does not reveal whether the file or its format was otherwise valid; only that the
  // password was wrong. The client can retry with a different password without re-uploading.
  "wrong-password": "wrong-password",
  // A beta-channel activation rejected because the required consent acknowledgment was absent.
  // Distinct from `validation` (request-shape failures) — the request is well-formed; a business
  // rule gates the channel transition on explicit opt-in.
  "beta-consent-required": "beta-consent-required",
  // A custody packet logged without a Directory owner (HTTP 422). The register's structural
  // invariant: an original the firm holds for nobody it can name can never be released and never be
  // destroyed, so the write path refuses it rather than accepting a record it cannot act on.
  "custody-owner-required": "custody-owner-required",
  // A hold in force forbids the requested action (HTTP 409) — a release or a destruction. A hold
  // deliberately does not block a location move, so this never fires on one.
  "custody-hold-blocks-action": "custody-hold-blocks-action",
  // A location refused because moving it would put it inside its own subtree, or past the depth cap
  // (HTTP 422). DISTINCT from `validation`: the request is well-formed; the tree refuses the shape.
  "custody-location-cycle": "custody-location-cycle",
  // A location closed while it or its subtree still physically holds packets (HTTP 409). Closing it
  // anyway would orphan originals in a container nobody looks at any more.
  "custody-location-occupied": "custody-location-occupied",
  // The custody-number draw did not converge, or a manual number is already taken (HTTP 409).
  "custody-number-exhausted": "custody-number-exhausted",
  // A movement the register refuses on its own terms (HTTP 422): a second check-out of a packet
  // already out, a new movement on a released packet, a correction naming nothing, a borrower kind
  // with no borrower.
  "custody-invalid-movement": "custody-invalid-movement",
  // An unexpected, unhandled server error (HTTP 500). The telemetry middleware's final catch maps
  // any escaped exception to this — the one error type the client cannot have caused, carrying only
  // the Error ID to quote.
  internal: "internal",
  // A feature that is known but not yet wired end-to-end (HTTP 501). Used for interim stubs where
  // the route schema and lane routing are in place but the backing implementation lands in a later
  // task. Clients should treat this like a transient error and retry after a deployment.
  "not-implemented": "not-implemented",
  // A template upload whose placeholders cannot be normalized (HTTP 422): an unclosed delimiter, a key
  // no merge field matches, a rendering the key's type does not support. DISTINCT from `validation`
  // (request-shape) — the request is well-formed; the uploaded document's authoring is not. Carries the
  // findings with their locations so the authoring surface can point at each one.
  "template-normalization-failed": "template-normalization-failed",
  // A template version that cannot be activated (HTTP 422): its bytes were flagged by the scan engine,
  // or macro content survived removal and the package could not be made safe to store. A registration
  // refusal, never a silent downgrade.
  "template-not-activatable": "template-not-activatable",
  // A template upload carrying macro content, registered without asking for the macros to be removed
  // (HTTP 422). Not an error in the document and not a scan verdict: a template is run against
  // privileged client data, so one carrying code is never stored, and removing the code rewrites the
  // firm's own document, so it is never done unasked. The problem carries what was found and names
  // both ways through — opt in to the removal, or upload a macro-free copy.
  "template-macro-consent-required": "template-macro-consent-required",
  // A template whose conditional, repeating, or computed-field expression does not check (HTTP 422):
  // a name no merge field matches, an operand type the operation does not take, a rendering the result
  // type does not support, an unbalanced block, or one past a declared bound. DISTINCT from
  // `template-normalization-failed`, which is about a placeholder's delimiters rather than about what
  // an expression means. Carries the part, the excerpt, and the character offset inside the expression.
  "template-expression-invalid": "template-expression-invalid",
  // An assembly whose expression could not produce a value from data that all resolved (HTTP 422): two
  // amounts in different currencies, a division that is not exact, a bound reached, or a condition
  // nobody can answer because the matter supplies no value for a field it reads. A refusal ALWAYS fails
  // the assembly — it never becomes false, never becomes blank, and never becomes a rounded guess,
  // because a missing clause is invisible to whoever reads the document. Reports WHICH expression and
  // WHY, never what any value held.
  "assembly-expression-refused": "assembly-expression-refused",
  // An assembly whose merge fields cannot be resolved (HTTP 422): the matter supplies no value for a
  // field declared to fail rather than render a blank. Names WHICH keys failed, never what they held.
  "merge-field-unresolvable": "merge-field-unresolvable",
  // A plain request reached an endpoint that only serves WebSocket subscriptions (HTTP 426). The
  // job-progress endpoints push transitions over a socket; the polling endpoint beside each one is
  // the answer for a client that cannot or does not want to upgrade, and the detail names it.
  "websocket-upgrade-required": "websocket-upgrade-required",
  // A required downstream service is absent or unreachable (HTTP 503): the worker cannot fulfil
  // the request because a backing worker service binding is not configured. Callers should retry
  // after a short delay; the condition resolves when the binding is activated at deploy time.
  "service-unavailable": "service-unavailable",
} as const;

export type ProblemTypeKey = keyof typeof PROBLEM_TYPES;

// The full `type` URI for a registered key — a template-literal type, not `string`, so the
// registry guarantee (only registered URIs are ever emitted) carries through to consumers.
export type ProblemTypeUri = `https://api.magnacarta.esq/problems/${ProblemTypeKey}`;

export function problemType(key: ProblemTypeKey): ProblemTypeUri {
  return `https://api.magnacarta.esq/problems/${PROBLEM_TYPES[key]}`;
}
