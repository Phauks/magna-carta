// A row read back from idempotency_key (snake_case — D1 column names pass through as-is).
export interface IdempotencyRecordRow {
  readonly key: string;
  readonly fingerprint: string;
  readonly status: "in_progress" | "completed";
  readonly response_code: number | null;
  readonly response_body: string | null;
}

export type IdempotencyDecision =
  | { kind: "execute" } // no record — run the effect
  | { kind: "replay"; responseCode: number; responseBody: string | null } // completed, same fingerprint
  | { kind: "in-progress" } // -> 409. Reserved state: the batch path writes completed directly
  | { kind: "fingerprint-mismatch" }; // -> 422 (key reused for a different payload)

// The ADR-0063 decision table over an existing record. Mismatch wins over status: a key reused for a
// different payload is a client bug regardless of what the original request is doing.
export function decideIdempotency(
  record: IdempotencyRecordRow | undefined,
  fingerprint: string,
): IdempotencyDecision {
  if (record === undefined) return { kind: "execute" };
  if (record.fingerprint !== fingerprint) return { kind: "fingerprint-mismatch" };
  if (record.status === "in_progress") return { kind: "in-progress" };
  // A completed record always replays — including stored failures (a retry never silently re-runs).
  // A completed record with no stored code is malformed; surface it as a 500 rather than guess.
  return { kind: "replay", responseCode: record.response_code ?? 500, responseBody: record.response_body };
}
