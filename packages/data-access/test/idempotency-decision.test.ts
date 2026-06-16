import { describe, expect, it } from "vitest";
import { decideIdempotency, type IdempotencyRecordRow } from "../src/idempotency-decision.ts";

const FINGERPRINT = "a".repeat(64);

function record(overrides: Partial<IdempotencyRecordRow> = {}): IdempotencyRecordRow {
  return {
    key: "client-key-1",
    fingerprint: FINGERPRINT,
    status: "completed",
    response_code: 201,
    response_body: '{"id":"invoice_x"}',
    ...overrides,
  };
}

describe("decideIdempotency (decision table)", () => {
  it("no record -> execute", () => {
    expect(decideIdempotency(undefined, FINGERPRINT)).toEqual({ kind: "execute" });
  });

  it("completed + same fingerprint -> replay the stored response", () => {
    expect(decideIdempotency(record(), FINGERPRINT)).toEqual({
      kind: "replay",
      responseCode: 201,
      responseBody: '{"id":"invoice_x"}',
    });
  });

  it("a stored FAILURE replays too — a retried operation never silently re-runs", () => {
    const failed = record({ response_code: 500, response_body: '{"error":"processor down"}' });
    expect(decideIdempotency(failed, FINGERPRINT)).toEqual({
      kind: "replay",
      responseCode: 500,
      responseBody: '{"error":"processor down"}',
    });
  });

  it("in_progress + same fingerprint -> in-progress (409)", () => {
    expect(
      decideIdempotency(record({ status: "in_progress", response_code: null }), FINGERPRINT),
    ).toEqual({ kind: "in-progress" });
  });

  it("any status + different fingerprint -> fingerprint-mismatch (422), mismatch wins over status", () => {
    const other = "b".repeat(64);
    expect(decideIdempotency(record(), other)).toEqual({ kind: "fingerprint-mismatch" });
    expect(decideIdempotency(record({ status: "in_progress" }), other)).toEqual({
      kind: "fingerprint-mismatch",
    });
  });

  it("completed but no stored code (malformed record) still replays with a 500 fallback", () => {
    const malformed = record({ response_code: null, response_body: null });
    expect(decideIdempotency(malformed, FINGERPRINT)).toEqual({
      kind: "replay",
      responseCode: 500,
      responseBody: null,
    });
  });
});
