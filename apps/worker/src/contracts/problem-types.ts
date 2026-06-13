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
  // An unexpected, unhandled server error (HTTP 500). The telemetry middleware's final catch maps
  // any escaped exception to this — the one error type the client cannot have caused, carrying only
  // the Error ID to quote (slice 0·6; ADR-0017/ADR-0038).
  internal: "internal",
} as const;

export type ProblemTypeKey = keyof typeof PROBLEM_TYPES;

// The full `type` URI for a registered key — a template-literal type, not `string`, so the
// registry guarantee (only registered URIs are ever emitted) carries through to consumers.
export type ProblemTypeUri = `https://api.magnacarta.esq/problems/${ProblemTypeKey}`;

export function problemType(key: ProblemTypeKey): ProblemTypeUri {
  return `https://api.magnacarta.esq/problems/${PROBLEM_TYPES[key]}`;
}
