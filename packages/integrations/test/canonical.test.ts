import { describe, expect, it } from "vitest";
import { z } from "zod";
import { canonicalRecordSchema } from "../src/canonical.ts";

const eventSchema = canonicalRecordSchema({ title: z.string() });

describe("canonicalRecordSchema", () => {
  it("requires remoteId and the port's fields, allows an optional raw payload", () => {
    const parsed = eventSchema.parse({ remoteId: "abc", title: "Hearing", raw: { vendor: 1 } });
    expect(parsed.remoteId).toBe("abc");
    expect(parsed.title).toBe("Hearing");
    expect(parsed.raw).toEqual({ vendor: 1 });
  });

  it("rejects a record missing remoteId (the boundary guard)", () => {
    expect(eventSchema.safeParse({ title: "Hearing" }).success).toBe(false);
  });

  it("makes raw optional — a record without it parses, raw undefined", () => {
    const result = eventSchema.safeParse({ remoteId: "a", title: "T" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.raw).toBeUndefined();
  });
});
