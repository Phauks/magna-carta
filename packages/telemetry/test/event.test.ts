import { describe, expect, it } from "vitest";
import { defineEvent, UNLOGGABLE_VALUE, type TelemetryEvent } from "../src/event.ts";

const context = { correlationId: "correlation_abc123", now: "2026-06-13T00:00:00.000Z" };

describe("defineEvent — the allowlist IS the builder", () => {
  it("builds an event carrying the declared fields, name, instant, and correlation id", () => {
    const build = defineEvent("test.event", ["route", "status"] as const);
    const event = build(context, { route: "/api/v1/things/:id", status: 200 });
    expect(event).toEqual<TelemetryEvent>({
      name: "test.event",
      at: "2026-06-13T00:00:00.000Z",
      correlationId: "correlation_abc123",
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

// Stripping undeclared KEYS was never enough on its own: a declared key can be handed a value the
// type says is impossible, and the emitted line is JSON, so a structure lands in it whole.
describe("defineEvent — the allowlist governs VALUES, not only keys", () => {
  const build = defineEvent("test.values", ["declared"] as const);

  function forceValue(value: unknown) {
    return build(context, { declared: value } as unknown as { declared: string });
  }

  it("replaces an object smuggled through a declared field, keeping none of its content", () => {
    const event = forceValue({
      clientName: "Jane Smith",
      nested: { matterNumber: "2026-0042", note: "privileged" },
    });
    expect(event.fields.declared).toBe(UNLOGGABLE_VALUE);
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("Jane Smith");
    expect(serialized).not.toContain("2026-0042");
    expect(serialized).not.toContain("privileged");
  });

  it("replaces an array — the same leak with a different container", () => {
    const event = forceValue(["Jane Smith", "opposing counsel"]);
    expect(event.fields.declared).toBe(UNLOGGABLE_VALUE);
    expect(JSON.stringify(event)).not.toContain("Jane Smith");
  });

  it("replaces an Error instance rather than letting its message through a non-message field", () => {
    const event = forceValue(new Error("account 4111111111111111 rejected"));
    expect(event.fields.declared).toBe(UNLOGGABLE_VALUE);
  });

  it("replaces values JSON.stringify would throw on, so an emit can never be taken down by one", () => {
    expect(forceValue(10n).fields.declared).toBe(UNLOGGABLE_VALUE);
    expect(forceValue(Symbol("s")).fields.declared).toBe(UNLOGGABLE_VALUE);
    expect(forceValue(() => "x").fields.declared).toBe(UNLOGGABLE_VALUE);
    // The whole point of the replacement: the event still serialises.
    expect(() => JSON.stringify(forceValue(10n))).not.toThrow();
  });

  it("replaces a self-referential object instead of throwing on the cycle", () => {
    const cyclic: Record<string, unknown> = { name: "Jane Smith" };
    cyclic.self = cyclic;
    expect(forceValue(cyclic).fields.declared).toBe(UNLOGGABLE_VALUE);
  });

  it("still passes every legitimate flat primitive through untouched", () => {
    expect(forceValue("plain text").fields.declared).toBe("plain text");
    expect(forceValue(0).fields.declared).toBe(0);
    expect(forceValue(false).fields.declared).toBe(false);
    expect(forceValue(null).fields.declared).toBe(null);
  });
});
