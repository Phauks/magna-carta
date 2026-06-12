// The problem-type URI registry (design spec, error model): every RFC 9457 `type` URI the API
// emits is a key here (registry-first — stable URIs, one docs page each). A closed union: handing
// problemType() an unregistered key is a compile error, so a new problem type means a new row here.
export const PROBLEM_TYPES = {
  validation: "validation",
  unauthenticated: "unauthenticated",
  "permission-denied": "permission-denied",
  "not-found": "not-found",
  "idempotency-key-missing": "idempotency-key-missing",
  "idempotency-key-conflict": "idempotency-key-conflict",
  "idempotency-fingerprint-mismatch": "idempotency-fingerprint-mismatch",
  "rate-limited": "rate-limited",
} as const;

export type ProblemTypeKey = keyof typeof PROBLEM_TYPES;

export function problemType(key: ProblemTypeKey): string {
  return `https://api.magnacarta.esq/problems/${PROBLEM_TYPES[key]}`;
}
