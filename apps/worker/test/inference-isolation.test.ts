import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import {
  readTokenUsage,
  tokenUsageCommitStatements,
} from "@magna-carta/data-access/token-usage-statements";
import { primaryReasoningModelDefinition } from "@magna-carta/inference/settings";
import type { Bindings } from "../src/app.ts";
import { handleInferenceJob } from "../src/inference/inference-consumer.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import { seedFirm } from "./support/test-auth.ts";

let firmOneId: string;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  // migrate to head — the full committed per-firm lineage, including the token_usage_meter table
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_2);
  const firmOne = await seedFirm({
    name: "Inference Firm One",
    databaseIdentifier: "DB_FIRM_POOL_1",
  });
  await seedFirm({ name: "Inference Firm Two", databaseIdentifier: "DB_FIRM_POOL_2" });
  firmOneId = firmOne.firmId;
});

const now = () => "2026-06-18T00:00:00.000Z";

describe("inference per-firm isolation (the firm's own D1 handle)", () => {
  it("a firm's reasoning-model setting never resolves across firms", async () => {
    // Write firm one's selection through the write path (validated, never a raw insert).
    await commitEffectBatch(
      env.DB_FIRM_POOL_1,
      {
        statements: [
          writeFirmSettingStatement(
            env.DB_FIRM_POOL_1,
            primaryReasoningModelDefinition,
            "anthropic/claude-sonnet-4-6",
            now(),
          ),
        ],
        outboxMessages: [],
      },
      { now },
    );

    const { results: one } = await env.DB_FIRM_POOL_1.prepare(
      "SELECT value FROM setting WHERE key = ?1",
    )
      .bind(primaryReasoningModelDefinition.key)
      .all<{ value: string }>();
    const { results: two } = await env.DB_FIRM_POOL_2.prepare(
      "SELECT value FROM setting WHERE key = ?1",
    )
      .bind(primaryReasoningModelDefinition.key)
      .all<{ value: string }>();
    expect(JSON.parse(one[0]!.value)).toBe("anthropic/claude-sonnet-4-6");
    expect(two).toHaveLength(0); // firm two carries no row — its read would return the default
  });

  it("a firm's token-usage record never resolves across firms", async () => {
    // Meter a run in firm one through the write path (effect batch, never a raw insert).
    await commitEffectBatch(
      env.DB_FIRM_POOL_1,
      {
        statements: tokenUsageCommitStatements(
          env.DB_FIRM_POOL_1,
          { day: "2026-06-18", slot: "reasoning", modelId: "anthropic/claude-opus-4-8" },
          100,
          200,
        ),
        outboxMessages: [],
      },
      { now },
    );

    const firmOneUsage = await readTokenUsage(env.DB_FIRM_POOL_1);
    const firmTwoUsage = await readTokenUsage(env.DB_FIRM_POOL_2);
    // Firm one must carry exactly the opus row seeded above (the sonnet setting-write in test 1
    // touches only the setting table, not token_usage_meter, so only one usage row exists here).
    expect(firmOneUsage).toEqual([
      {
        slot: "reasoning",
        modelId: "anthropic/claude-opus-4-8",
        inputTokens: 100,
        outputTokens: 200,
        requestCount: 1,
      },
    ]);
    expect(firmTwoUsage).toEqual([]); // firm two's database has no such row — structural isolation
  });

  it("handleInferenceJob meters the AI response into the resolved firm's D1 and does not touch the other firm", async () => {
    // Build a minimal env that handleInferenceJob accepts: the real firm-pool bindings (so
    // resolveFirmDatabase can look them up by name from its hardcoded pool), plus a fake AI
    // binding that returns a known response+usage without calling the gateway.
    const fakeAi = {
      run: async (_model: string, _input: unknown, _options: unknown) => ({
        response: "Drafted.",
        usage: { input_tokens: 7, output_tokens: 13 },
      }),
    };
    const fakeEnv = {
      DB_FIRM_POOL_1: env.DB_FIRM_POOL_1,
      DB_FIRM_POOL_2: env.DB_FIRM_POOL_2,
      AI: fakeAi,
    } as unknown as Bindings;

    // Firm one's setting was written to anthropic/claude-sonnet-4-6 in test 1. handleInferenceJob
    // reads that setting, calls fakeAi.run, then meters the response into the firm's D1.
    await handleInferenceJob(fakeEnv, {
      firmId: firmOneId,
      databaseIdentifier: "DB_FIRM_POOL_1",
      prompt: "Draft.",
    });

    // Firm one now has two usage rows: the opus row from test 2, and a sonnet row from this run.
    // Assert the sonnet row carries the exact token counts from the fake AI response.
    const firmOneUsage = await readTokenUsage(env.DB_FIRM_POOL_1);
    const sonnetRow = firmOneUsage.find((row) => row.modelId === "anthropic/claude-sonnet-4-6");
    expect(sonnetRow).toEqual({
      slot: "reasoning",
      modelId: "anthropic/claude-sonnet-4-6",
      inputTokens: 7,
      outputTokens: 13,
      requestCount: 1,
    });

    // Firm two must remain unaffected — the consumer's structural isolation guarantee.
    const firmTwoUsage = await readTokenUsage(env.DB_FIRM_POOL_2);
    expect(firmTwoUsage).toEqual([]);
  });
});
