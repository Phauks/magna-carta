import { describe, expect, it } from "vitest";
import { defineEvent, type TelemetryEvent } from "../src/event.ts";

const context = { correlationId: "cor_abc123", now: "2026-06-13T00:00:00.000Z" };

describe("defineEvent — the allowlist IS the builder", () => {
  it("builds an event carrying the declared fields, name, instant, and correlation id", () => {
    const build = defineEvent("test.event", ["route", "status"] as const);
    const event = build(context, { route: "/api/v1/things/:id", status: 200 });
    expect(event).toEqual<TelemetryEvent>({
      name: "test.event",
      at: "2026-06-13T00:00:00.000Z",
      correlationId: "cor_abc123",
      fields: { route: "/api/v1/things/:id", status: 200 },
    });
  });

  it("keeps null, boolean, and number field values verbatim", () => {
    const build = defineEvent("test.values", ["a", "b", "c"] as const);
    const event = build(context, { a: null, b: false, c: 0 });
    expect(event.fields).toEqual({ a: null, b: false, c: 0 });
  });

  it("strips an undeclared key forced in through a cast (runtime defense against `as any`)", () => {
    const build = defineEvent("test.strip", ["allowed"] as const);
    const event = build(context, { allowed: "kept", secret: "leaked" } as unknown as {
      allowed: string;
    });
    expect(event.fields).toEqual({ allowed: "kept" });
    expect(event.fields).not.toHaveProperty("secret");
  });

  it("produces no own-enumerable key for a declared field that was omitted (only passes through what is given)", () => {
    const build = defineEvent("test.partial", ["x", "y"] as const);
    // Force a partial object past the type to prove the loop only copies present allowed keys.
    const event = build(context, { x: 1 } as unknown as { x: number; y: number });
    expect(event.fields).toEqual({ x: 1 });
  });
});
