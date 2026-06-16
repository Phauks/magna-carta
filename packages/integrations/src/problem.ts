// The one integration error taxonomy. Adapters map heterogeneous vendor errors into this shape
// (their job, not the caller's); the framework reads it to drive retry (cross-cutting scaffolding)
// and the connection health state machine. It is the RFC 9457 problem shape the API already speaks,
// extended with `retryable` and `category` — the worker maps it onto its own problem module at the
// HTTP boundary, so this pure package needs no worker dependency.
export type ProblemCategory = "auth" | "rate_limit" | "validation" | "upstream" | "network";

export interface IntegrationProblem {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly correlationId?: string;
  readonly retryable: boolean;
  readonly category: ProblemCategory;
}

// Transient categories are safe to retry with backoff; auth/validation are terminal until the
// caller acts (reauthorize / fix the request).
const RETRYABLE_CATEGORIES: ReadonlySet<ProblemCategory> = new Set([
  "rate_limit",
  "upstream",
  "network",
]);

export interface IntegrationProblemOptions {
  // Caller-safe text only — adapters must never splice raw upstream response bodies (which can echo
  // tokens/auth headers) into `detail`.
  readonly detail?: string;
  readonly correlationId?: string;
  readonly type?: string;
}

export function integrationProblem(
  category: ProblemCategory,
  status: number,
  title: string,
  options: IntegrationProblemOptions = {},
): IntegrationProblem {
  return {
    type: options.type ?? `https://api.magnacarta.esq/problems/integration/${category}`,
    title,
    status,
    detail: options.detail,
    correlationId: options.correlationId,
    category,
    retryable: RETRYABLE_CATEGORIES.has(category),
  };
}
