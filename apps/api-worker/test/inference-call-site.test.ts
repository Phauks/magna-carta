// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { AiBinding } from "@magna-carta/inference/gateway";
import { inferencePortFor, resolveReasoningModel } from "../src/inference/call-site.ts";

const NO_AI: AiBinding = { run: async () => ({ response: "", usage: {} }) };

function fakeFirmDatabase(stored?: string) {
  return {
    prepare(_sql: string) {
      const binds: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          binds.push(...values);
          return this;
        },
        async all<T>() {
          return {
            results: (stored === undefined ? [] : [{ value: JSON.stringify(stored) }]) as T[],
          };
        },
        async run() {
          return { meta: { changes: 1 } };
        },
      };
    },
  };
}

describe("resolveReasoningModel", () => {
  it("returns the firm's stored model through the firm-scoped read", async () => {
    expect(
      await resolveReasoningModel(
        fakeFirmDatabase("anthropic/claude-sonnet-5-5") as unknown as SqlDatabase,
      ),
    ).toBe("anthropic/claude-sonnet-5-5");
  });

  it("returns the safe default when no firm row is set", async () => {
    expect(await resolveReasoningModel(fakeFirmDatabase() as unknown as SqlDatabase)).toBe(
      "anthropic/claude-opus-5-5",
    );
  });
});

describe("inferencePortFor", () => {
  it("constructs the AI-Gateway-backed port with the injected binding", () => {
    const port = inferencePortFor(NO_AI, "production");
    expect(typeof port.generate).toBe("function");
    expect(typeof port.embed).toBe("function");
  });
});
