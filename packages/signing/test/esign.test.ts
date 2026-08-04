import { describe, expect, it } from "vitest";

import { ATTRIBUTION_ORDER, attributionMeets } from "../src/esign.ts";
import { toPdfDate } from "../src/seal.ts";

describe("attribution ladder", () => {
  it("orders assurance weakest to strongest", () => {
    expect(ATTRIBUTION_ORDER[0]).toBe("email-link");
    expect(ATTRIBUTION_ORDER[ATTRIBUTION_ORDER.length - 1]).toBe("firm-authenticated");
  });

  it("compares a level against a required minimum", () => {
    expect(attributionMeets("firm-authenticated", "email-link")).toBe(true);
    expect(attributionMeets("id-verified", "id-verified")).toBe(true);
    expect(attributionMeets("email-link", "id-verified")).toBe(false);
    expect(attributionMeets("portal-authenticated", "access-code")).toBe(true);
  });
});

describe("toPdfDate", () => {
  it("formats a Date as a UTC PDF date string", () => {
    expect(toPdfDate(new Date("2026-07-18T09:05:03Z"))).toBe("D:20260718090503Z");
    expect(toPdfDate(new Date("2026-01-02T00:00:00Z"))).toBe("D:20260102000000Z");
  });
});
