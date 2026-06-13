import { describe, expect, it } from "vitest";
import { ENTITY_PREFIXES, prefixFor } from "../src/registry.ts";

describe("prefix registry", () => {
  it("maps the known entity types to their prefixes", () => {
    expect(prefixFor("matter")).toBe("mat");
    expect(prefixFor("document")).toBe("doc");
    expect(prefixFor("firm")).toBe("firm");
    expect(prefixFor("idempotencyRecord")).toBe("idr");
  });

  it("maps the auth and access-control entity types to their prefixes", () => {
    expect(prefixFor("session")).toBe("ses");
    expect(prefixFor("account")).toBe("acc");
    expect(prefixFor("verification")).toBe("ver");
    expect(prefixFor("twoFactor")).toBe("twf");
    expect(prefixFor("role")).toBe("rol");
    expect(prefixFor("rolePermission")).toBe("rpm");
    expect(prefixFor("memberRole")).toBe("mrl");
    expect(prefixFor("grant")).toBe("gnt");
    expect(prefixFor("authAudit")).toBe("aud");
  });

  it("maps the error-report entity type to its prefix", () => {
    expect(prefixFor("error")).toBe("err");
  });

  it("maps the telemetry entity types to their prefixes (slice 0·6)", () => {
    expect(prefixFor("correlation")).toBe("cor");
    expect(prefixFor("incident")).toBe("inc");
  });

  it("has no duplicate prefixes (prefix space partitions the id space)", () => {
    const prefixes = Object.values(ENTITY_PREFIXES);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("every prefix is lowercase letters only (no digits, no underscore)", () => {
    for (const prefix of Object.values(ENTITY_PREFIXES)) {
      expect(prefix).toMatch(/^[a-z]+$/);
    }
  });
});
