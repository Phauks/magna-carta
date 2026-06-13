import { describe, expect, it } from "vitest";
import { canonicalJsonStringify, fingerprintRequest } from "../src/canonical.ts";

describe("canonicalJsonStringify", () => {
  it("produces identical output regardless of key order, recursively", () => {
    const a = { b: 2, a: 1, nested: { y: [1, 2], x: "v" } };
    const b = { a: 1, nested: { x: "v", y: [1, 2] }, b: 2 };
    expect(canonicalJsonStringify(a)).toBe(canonicalJsonStringify(b));
    expect(canonicalJsonStringify(a)).toBe('{"a":1,"b":2,"nested":{"x":"v","y":[1,2]}}');
  });

  it("preserves array order (arrays are positional, not key-ordered)", () => {
    expect(canonicalJsonStringify([3, 1, 2])).toBe("[3,1,2]");
  });
});

describe("fingerprintRequest", () => {
  it("returns 64-char lowercase hex, stable across body key order", async () => {
    const one = await fingerprintRequest({
      method: "POST",
      path: "/api/payments",
      body: { amountMinor: 100, matterId: "matter_x" },
    });
    const two = await fingerprintRequest({
      method: "post",
      path: "/api/payments",
      body: { matterId: "matter_x", amountMinor: 100 },
    });
    expect(one).toMatch(/^[0-9a-f]{64}$/);
    expect(two).toBe(one); // method case-insensitive, body key order irrelevant
  });

  it("differs across method, path, and body (the endpoint is part of the fingerprint)", async () => {
    const base = { method: "POST", path: "/api/payments", body: { a: 1 } };
    const samePathDifferentBody = await fingerprintRequest({ ...base, body: { a: 2 } });
    const differentPath = await fingerprintRequest({ ...base, path: "/api/invoices" });
    const differentMethod = await fingerprintRequest({ ...base, method: "PUT" });
    const original = await fingerprintRequest(base);
    expect(new Set([original, samePathDifferentBody, differentPath, differentMethod]).size).toBe(4);
  });

  it("allows an undefined body (e.g. a DELETE)", async () => {
    const fingerprint = await fingerprintRequest({
      method: "DELETE",
      path: "/api/things/x",
      body: undefined,
    });
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});
