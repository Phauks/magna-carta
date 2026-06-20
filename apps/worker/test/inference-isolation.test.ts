import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import {
  readTokenUsage,
  tokenUsageCommitStatements,
} from "@magna-carta/data-access/token-usage-statements";
import { primaryReasoningModelDefinition } from "@magna-carta/inference/settings";
import type { Bindings } from "../src/app.ts";
import {
  handleInferenceJob,
  inferenceQueue,
  type InferenceJob,
} from "../src/inference/inference-consumer.ts";
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

describe("inference consumer resilience", () => {
  // All four tests run against the real Miniflare D1 (POOL_1, the same firm seeded in beforeAll)
  // with a fake AI binding. Each uses read-before/read-after delta assertions against the specific
  // (slot, modelId) row so they are order-independent and never collide with Part A/B rows.

  it("retryable AI failure throws so the queue redelivers, and no metering row is written", async () => {
    // The AI binding throws (simulating a transient upstream error). The gateway catches the throw
    // and maps it to an adapterError with category "upstream" (retryable: true). handleInferenceJob
    // sees !result.ok && retryable === true and re-throws, signalling the queue to redeliver.
    const throwingAi = {
      run: async (_model: string, _input: unknown, _options: unknown): Promise<never> => {
        throw new Error("upstream 503: transient");
      },
    };
    const fakeEnv = {
      DB_FIRM_POOL_1: env.DB_FIRM_POOL_1,
      DB_FIRM_POOL_2: env.DB_FIRM_POOL_2,
      AI: throwingAi,
    } as unknown as Bindings;

    // The firm setting is already anthropic/claude-sonnet-4-6 (written in Part A test 1).
    // Read the sonnet row before the failing call so the delta can be checked.
    const usageBefore = await readTokenUsage(env.DB_FIRM_POOL_1);
    const sonnetBefore = usageBefore.find((r) => r.modelId === "anthropic/claude-sonnet-4-6");

    await expect(
      handleInferenceJob(fakeEnv, {
        firmId: firmOneId,
        databaseIdentifier: "DB_FIRM_POOL_1",
        prompt: "trigger-retryable",
      }),
    ).rejects.toThrow();

    // The failed run must not have written any new metering tokens — the throw exits before the
    // commitEffectBatch call, so the row is unchanged.
    const usageAfter = await readTokenUsage(env.DB_FIRM_POOL_1);
    const sonnetAfter = usageAfter.find((r) => r.modelId === "anthropic/claude-sonnet-4-6");
    expect(sonnetAfter?.requestCount ?? 0).toBe(sonnetBefore?.requestCount ?? 0);
    expect(sonnetAfter?.inputTokens ?? 0).toBe(sonnetBefore?.inputTokens ?? 0);
    expect(sonnetAfter?.outputTokens ?? 0).toBe(sonnetBefore?.outputTokens ?? 0);
  });

  it("unknown database identifier resolves to no DB — acks (no throw), no model call, no metering", async () => {
    // resolveFirmDatabase returns null for an unrecognised identifier: the consumer acks without
    // calling the model. Retrying cannot conjure a missing binding; the correct behaviour is a
    // silent early return so the message does not re-enter the dead-letter queue.
    const aiSpy = vi.fn();
    const fakeEnv = {
      DB_FIRM_POOL_1: env.DB_FIRM_POOL_1,
      DB_FIRM_POOL_2: env.DB_FIRM_POOL_2,
      AI: { run: aiSpy },
    } as unknown as Bindings;

    const usageBefore = await readTokenUsage(env.DB_FIRM_POOL_1);
    const totalRequestsBefore = usageBefore.reduce((s, r) => s + r.requestCount, 0);

    // The databaseIdentifier names a pool slot that does not exist in the binding map.
    await expect(
      handleInferenceJob(fakeEnv, {
        firmId: firmOneId,
        databaseIdentifier: "DB_FIRM_POOL_DOES_NOT_EXIST",
        prompt: "should-never-reach-model",
      }),
    ).resolves.toBeUndefined();

    expect(aiSpy).not.toHaveBeenCalled();

    const usageAfter = await readTokenUsage(env.DB_FIRM_POOL_1);
    const totalRequestsAfter = usageAfter.reduce((s, r) => s + r.requestCount, 0);
    expect(totalRequestsAfter).toBe(totalRequestsBefore);
  });

  it("inferenceQueue acks the successful message and retries only the failing one — per-message isolation", async () => {
    // A batch of two messages: one with a normal prompt (succeeds) and one whose prompt contains
    // "boom" (the conditional fake AI throws for it, simulating a transient upstream failure).
    // The queue consumer must ack the good message and retry only the bad one — a single failure
    // must never re-run a sibling that already committed.
    const conditionalAi = {
      run: async (_model: string, input: unknown, _options: unknown): Promise<unknown> => {
        const typedInput = input as { prompt?: string };
        if (typedInput.prompt?.includes("boom")) {
          throw new Error("upstream 503: transient");
        }
        return { response: "ok", usage: { input_tokens: 3, output_tokens: 5 } };
      },
    };
    const fakeEnv = {
      DB_FIRM_POOL_1: env.DB_FIRM_POOL_1,
      DB_FIRM_POOL_2: env.DB_FIRM_POOL_2,
      AI: conditionalAi,
      TELEMETRY: env.TELEMETRY,
    } as unknown as Bindings;

    const msgGood = {
      id: "msg-good-1",
      body: {
        firmId: firmOneId,
        databaseIdentifier: "DB_FIRM_POOL_1",
        prompt: "good prompt",
      } satisfies InferenceJob,
      ack: vi.fn(),
      retry: vi.fn(),
    };
    const msgBad = {
      id: "msg-bad-1",
      body: {
        firmId: firmOneId,
        databaseIdentifier: "DB_FIRM_POOL_1",
        prompt: "boom",
      } satisfies InferenceJob,
      ack: vi.fn(),
      retry: vi.fn(),
    };

    const fakeBatch = {
      queue: "magna-carta-production-inference",
      messages: [msgGood, msgBad],
    };

    await inferenceQueue(fakeBatch as unknown as MessageBatch<InferenceJob>, fakeEnv);

    expect(msgGood.ack).toHaveBeenCalledOnce();
    expect(msgGood.retry).not.toHaveBeenCalled();
    expect(msgBad.retry).toHaveBeenCalledOnce();
    expect(msgBad.ack).not.toHaveBeenCalled();
  });

  it("redelivery re-meters — at-least-once semantics write requestCount twice for the same job", async () => {
    // A redelivered message (e.g. the metering commit succeeded but was not acked before the
    // worker restarted) re-runs the model and increments requestCount again. This test pins that
    // documented at-least-once behaviour so a future producer-set idempotency key + dedup guard
    // that makes this exactly-once is visible as a deliberate change, not a silent regression.
    const fixedAi = {
      run: async (_model: string, _input: unknown, _options: unknown) => ({
        response: "idempotency-test",
        usage: { input_tokens: 50, output_tokens: 60 },
      }),
    };
    const fakeEnv = {
      DB_FIRM_POOL_1: env.DB_FIRM_POOL_1,
      DB_FIRM_POOL_2: env.DB_FIRM_POOL_2,
      AI: fixedAi,
    } as unknown as Bindings;

    // Read the sonnet row baseline before either call so we measure only this test's contribution.
    const usageBefore = await readTokenUsage(env.DB_FIRM_POOL_1);
    const sonnetBefore = usageBefore.find((r) => r.modelId === "anthropic/claude-sonnet-4-6");
    const baseRequestCount = sonnetBefore?.requestCount ?? 0;
    const baseInputTokens = sonnetBefore?.inputTokens ?? 0;
    const baseOutputTokens = sonnetBefore?.outputTokens ?? 0;

    const job: InferenceJob = {
      firmId: firmOneId,
      databaseIdentifier: "DB_FIRM_POOL_1",
      prompt: "redelivery-rerun",
    };

    // First delivery — meters one run.
    await handleInferenceJob(fakeEnv, job);
    // Second delivery of the identical job — meters again (at-least-once).
    await handleInferenceJob(fakeEnv, job);

    const usageAfter = await readTokenUsage(env.DB_FIRM_POOL_1);
    const sonnetAfter = usageAfter.find((r) => r.modelId === "anthropic/claude-sonnet-4-6");

    expect(sonnetAfter?.requestCount).toBe(baseRequestCount + 2);
    expect(sonnetAfter?.inputTokens).toBe(baseInputTokens + 100);
    expect(sonnetAfter?.outputTokens).toBe(baseOutputTokens + 120);
  });
});
