import { describe, expect, it } from "vitest";
import type { SqlDatabase } from "../src/idempotency-statements.ts";
import {
  readTokenUsage,
  tokenUsageCommitStatements,
  type TokenUsageKey,
} from "../src/token-usage-statements.ts";

// A tiny in-memory database honoring the exact SQL the builder emits AND the real SqlStatement return
// shapes (run -> { meta: { changes } }, all -> { results }), so the fake conforms to SqlDatabase.
function fakeDatabase() {
  const rows = new Map<
    string,
    { input: number; output: number; count: number; key: TokenUsageKey }
  >();
  const database = {
    prepare(_sql: string) {
      let binds: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          binds = values;
          return this;
        },
        async run() {
          const [day, slot, modelId, input, output] = binds as [
            string,
            string,
            string,
            number,
            number,
          ];
          const composite = `${day}|${slot}|${modelId}`;
          const existing = rows.get(composite) ?? {
            input: 0,
            output: 0,
            count: 0,
            key: { day, slot, modelId },
          };
          existing.input += input;
          existing.output += output;
          existing.count += 1;
          rows.set(composite, existing);
          return { meta: { changes: 1 } };
        },
        async all<T>() {
          // SELECT slot, model_id, SUM(...) ... GROUP BY slot, model_id
          const grouped = new Map<
            string,
            { slot: string; model_id: string; i: number; o: number; c: number }
          >();
          for (const row of rows.values()) {
            const k = `${row.key.slot}|${row.key.modelId}`;
            const g = grouped.get(k) ?? {
              slot: row.key.slot,
              model_id: row.key.modelId,
              i: 0,
              o: 0,
              c: 0,
            };
            g.i += row.input;
            g.o += row.output;
            g.c += row.count;
            grouped.set(k, g);
          }
          return {
            results: [...grouped.values()].map((g) => ({
              slot: g.slot,
              model_id: g.model_id,
              input_tokens: g.i,
              output_tokens: g.o,
              request_count: g.c,
            })) as T[],
          };
        },
      };
    },
  };
  return database as unknown as SqlDatabase;
}

const KEY: TokenUsageKey = {
  day: "2026-06-18",
  slot: "reasoning",
  modelId: "anthropic/claude-opus-5-5",
};

describe("tokenUsageCommitStatements", () => {
  it("adds the delta to an existing day/slot/model bucket and increments the request count", async () => {
    const database = fakeDatabase();
    for (const statement of tokenUsageCommitStatements(database, KEY, 10, 20))
      await statement.run();
    for (const statement of tokenUsageCommitStatements(database, KEY, 5, 7)) await statement.run();
    const usage = await readTokenUsage(database);
    expect(usage).toEqual([
      {
        slot: "reasoning",
        modelId: "anthropic/claude-opus-5-5",
        inputTokens: 15,
        outputTokens: 27,
        requestCount: 2,
      },
    ]);
  });
});
