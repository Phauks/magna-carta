import { describe, expect, it } from "vitest";
import { ENTITY_PREFIXES, prefixFor } from "../src/registry.ts";

describe("prefix registry", () => {
  it("spells the prefix out in full — it is the entity type verbatim, never abbreviated", () => {
    // The convention: prefix === key. A handle reads as `<entityType>_<token>` (matter_…,
    // fileVersion_…, idempotencyRecord_…), so logs are self-describing and the prefix can never
    // drift from the key. This single invariant replaces a per-entity assertion list.
    for (const [type, prefix] of Object.entries(ENTITY_PREFIXES)) {
      expect(prefix, type).toBe(type);
    }
  });

  it("resolves a representative spread of entity types to their full-name prefixes", () => {
    expect(prefixFor("matter")).toBe("matter");
    expect(prefixFor("ledgerAccount")).toBe("ledgerAccount");
    expect(prefixFor("idempotencyRecord")).toBe("idempotencyRecord");
    expect(prefixFor("twoFactor")).toBe("twoFactor");
    expect(prefixFor("fileVersion")).toBe("fileVersion");
    expect(prefixFor("auditLog")).toBe("auditLog");
  });

  it("maps the telemetry entity types to their prefixes (slice 0·6)", () => {
    expect(prefixFor("correlation")).toBe("correlation");
    expect(prefixFor("incident")).toBe("incident");
  });

  it("maps the firm-secret entity type to its full-name prefix", () => {
    expect(prefixFor("firmSecret")).toBe("firmSecret");
  });

  it("has no duplicate prefixes (prefix space partitions the id space)", () => {
    const prefixes = Object.values(ENTITY_PREFIXES);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("every prefix is camelCase letters only — no digits, no underscore (the `_` is the separator)", () => {
    // A `_` in the prefix would collide with the prefix/token separator; a digit is never needed.
    // Word boundaries come from camelCase, so the prefix is one unambiguous token before the `_`.
    for (const prefix of Object.values(ENTITY_PREFIXES)) {
      expect(prefix).toMatch(/^[a-z][a-zA-Z]*$/);
    }
  });

  it("registers the custom-fields prefixes spelled in full", () => {
    expect(ENTITY_PREFIXES.customField).toBe("customField");
    expect(ENTITY_PREFIXES.picklistOption).toBe("picklistOption");
    expect(ENTITY_PREFIXES.customFieldValue).toBe("customFieldValue");
  });
});
