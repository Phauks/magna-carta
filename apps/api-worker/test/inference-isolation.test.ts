import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import {
  readTokenUsage,
  tokenUsageCommitStatements,
} from "@magna-carta/data-access/token-usage-statements";
import { primaryReasoningModelDefinition } from "@magna-carta/inference/settings";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../src/bindings.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  handleInferenceJob,
  inferenceQueue,
  type InferenceJob,
} from "../src/background/inference/inference-consumer.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { seedFirm } from "./support/test-auth.ts";

let firmOneId: FirmId;
let firmTwoId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmOneId = (await seedFirm({ name: "Inference Firm One" })).firmId;
  firmTwoId = (await seedFirm({ name: "Inference Firm Two" })).firmId;
});

const now = () => "2026-06-18T00:00:00.000Z";

describe("inference per-firm isolation (the firm's own database handle)", () => {
  it("a firm's reasoning-model setting never resolves across firms", async () => {
    const firmOne = firmDatabaseFor(env.FIRM_DATABASE, firmOneId);
    const firmTwo = firmDatabaseFor(env.FIRM_DATABASE, firmTwoId);
    // Write firm one's selection through the write path (validated, never a raw insert).
    await commitEffectBatch(
      firmOne,
      {
        statements: [
          writeFirmSettingStatement(
            firmOne,
            primaryReasoningModelDefinition,
            "anthropic/claude-sonnet-5-5",
            now(),
          ),
        ],
        outboxMessages: [],
      },
      { now },
    );

    const { results: one } = await firmOne
      .prepare("SELECT value FROM setting WHERE key = ?1")
      .bind(primaryReasoningModelDefinition.key)
      .all<{ value: string }>();
    const { results: two } = await firmTwo
      .prepare("SELECT value FROM setting WHERE key = ?1")
      .bind(primaryReasoningModelDefinition.key)
      .all<{ value: string }>();
    expect(JSON.parse(one[0]!.value)).toBe("anthropic/claude-sonnet-5-5");
    expect(two).toHaveLength(0); // firm two carries no row — its read would return the default
  });

  it("a firm's token-usage record never resolves across firms", async () => {
    const firmOne = firmDatabaseFor(env.FIRM_DATABASE, firmOneId);
    // Meter a run in firm one through the write path (effect batch, never a raw insert).
    await commitEffectBatch(
      firmOne,
      {
        statements: tokenUsageCommitStatements(
          firmOne,
          { day: "2026-06-18", slot: "reasoning", modelId: "anthropic/claude-opus-5-5" },
          100,
          200,
        ),
        outboxMessages: [],
      },
      { now },
    );

    const firmOneUsage = await readTokenUsage(firmOne);
    const firmTwoUsage = await readTokenUsage(firmDatabaseFor(env.FIRM_DATABASE, firmTwoId));
    // Firm one must carry exactly the opus row seeded above (the sonnet setting-write in test 1
    // touches only the setting table, not token_usage_meter, so only one usage row exists here).
    expect(firmOneUsage).toEqual([
      {
        slot: "reasoning",
        modelId: "anthropic/claude-opus-5-5",
        inputTokens: 100,
        outputTokens: 200,
        requestCount: 1,
      },
    ]);
    expect(firmTwoUsage).toEqual([]); // firm two's database has no such row — structural isolation
  });

  it("handleInferenceJob meters the AI response into the resolved firm's database and does not touch the other firm", async () => {
    // Build a minimal env that handleInferenceJob accepts: the per-firm FirmDatabase namespace (so the
    // consumer resolves each firm by firmId), plus a fake AI binding that returns a known
    // response+usage without calling the gateway.
    const fakeAi = {
      run: async (_model: string, _input: unknown, _options: unknown) => ({
        response: "Drafted.",
        usage: { input_tokens: 7, output_tokens: 13 },
      }),
    };
    const fakeEnv = {
      FIRM_DATABASE: env.FIRM_DATABASE,
      AI: fakeAi,
    } as unknown as Bindings;

    // Firm one's setting was written to anthropic/claude-sonnet-5-5 in test 1. handleInferenceJob
    // reads that setting, calls fakeAi.run, then meters the response into the firm's database.
    await handleInferenceJob(fakeEnv, {
      firmId: firmOneId,
      databaseIdentifier: "vestigial",
      prompt: "Draft.",
      idempotencyKey: "test:isolation-metering",
    });

    // Firm one now has two usage rows: the opus row from test 2, and a sonnet row from this run.
    // Assert the sonnet row carries the exact token counts from the fake AI response.
    const firmOneUsage = await readTokenUsage(firmDatabaseFor(env.FIRM_DATABASE, firmOneId));
    const sonnetRow = firmOneUsage.find((row) => row.modelId === "anthropic/claude-sonnet-5-5");
    expect(sonnetRow).toEqual({
      slot: "reasoning",
      modelId: "anthropic/claude-sonnet-5-5",
      inputTokens: 7,
      outputTokens: 13,
      requestCount: 1,
    });

    // Firm two must remain unaffected — the consumer's structural isolation guarantee.
    const firmTwoUsage = await readTokenUsage(firmDatabaseFor(env.FIRM_DATABASE, firmTwoId));
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
      FIRM_DATABASE: env.FIRM_DATABASE,
      AI: throwingAi,
    } as unknown as Bindings;

    // The firm setting is already anthropic/claude-sonnet-5-5 (written in Part A test 1).
    // Read the sonnet row before the failing call so the delta can be checked.
    const usageBefore = await readTokenUsage(firmDatabaseFor(env.FIRM_DATABASE, firmOneId));
    const sonnetBefore = usageBefore.find((r) => r.modelId === "anthropic/claude-sonnet-5-5");

    await expect(
      handleInferenceJob(fakeEnv, {
        firmId: firmOneId,
        databaseIdentifier: "vestigial",
        prompt: "trigger-retryable",
        idempotencyKey: "test:retryable-failure",
      }),
    ).rejects.toThrow();

    // The failed run must not have written any new metering tokens — the throw exits before the
    // commitEffectBatch call, so the row is unchanged.
    const usageAfter = await readTokenUsage(firmDatabaseFor(env.FIRM_DATABASE, firmOneId));
    const sonnetAfter = usageAfter.find((r) => r.modelId === "anthropic/claude-sonnet-5-5");
    expect(sonnetAfter?.requestCount ?? 0).toBe(sonnetBefore?.requestCount ?? 0);
    expect(sonnetAfter?.inputTokens ?? 0).toBe(sonnetBefore?.inputTokens ?? 0);
    expect(sonnetAfter?.outputTokens ?? 0).toBe(sonnetBefore?.outputTokens ?? 0);
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
      FIRM_DATABASE: env.FIRM_DATABASE,
      AI: conditionalAi,
      TELEMETRY: env.TELEMETRY,
    } as unknown as Bindings;

    const msgGood = {
      id: "msg-good-1",
      body: {
        firmId: firmOneId,
        databaseIdentifier: "vestigial",
        prompt: "good prompt",
        idempotencyKey: "test:batch-good-1",
      } satisfies InferenceJob,
      ack: vi.fn(),
      retry: vi.fn(),
    };
    const msgBad = {
      id: "msg-bad-1",
      body: {
        firmId: firmOneId,
        databaseIdentifier: "vestigial",
        prompt: "boom",
        idempotencyKey: "test:batch-bad-1",
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

  it("redelivery deduplicates — the dedup guard collapses a redelivered job to exactly one meter", async () => {
    // A redelivered message carries the same idempotencyKey as the original. The dedup record
    // inserted on the first successful commit is inside the same batch as the meter increment; the
    // second delivery's INSERT hits the UNIQUE constraint and rolls back the whole batch, so the
    // second delivery's meter is never written. This test pins that exactly-once guarantee:
    // the first delivery meters once, the second delivery throws (batch-rollback) and leaves the
    // meter unchanged. The sentinel comment this test replaced read "a future dedup guard makes
    // this exactly-once" — that future has arrived.
    const fixedAi = {
      run: async (_model: string, _input: unknown, _options: unknown) => ({
        response: "idempotency-test",
        usage: { input_tokens: 50, output_tokens: 60 },
      }),
    };
    const fakeEnv = {
      FIRM_DATABASE: env.FIRM_DATABASE,
      AI: fixedAi,
    } as unknown as Bindings;

    // Read the sonnet row baseline before either call so we measure only this test's contribution.
    const usageBefore = await readTokenUsage(firmDatabaseFor(env.FIRM_DATABASE, firmOneId));
    const sonnetBefore = usageBefore.find((r) => r.modelId === "anthropic/claude-sonnet-5-5");
    const baseRequestCount = sonnetBefore?.requestCount ?? 0;
    const baseInputTokens = sonnetBefore?.inputTokens ?? 0;
    const baseOutputTokens = sonnetBefore?.outputTokens ?? 0;

    const job: InferenceJob = {
      firmId: firmOneId,
      databaseIdentifier: "vestigial",
      prompt: "redelivery-rerun",
      idempotencyKey: "test:redelivery-rerun",
    };

    // First delivery — commits the meter + dedup record atomically.
    await handleInferenceJob(fakeEnv, job);
    // Second delivery of the identical job: the dedup INSERT hits the UNIQUE constraint and rolls
    // back the whole batch (meter increment included) — exactly-once guarantee in action.
    await expect(handleInferenceJob(fakeEnv, job)).rejects.toThrow();

    const usageAfter = await readTokenUsage(firmDatabaseFor(env.FIRM_DATABASE, firmOneId));
    const sonnetAfter = usageAfter.find((r) => r.modelId === "anthropic/claude-sonnet-5-5");

    // Only one delivery metered — the dedup guard prevented the second increment.
    expect(sonnetAfter?.requestCount).toBe(baseRequestCount + 1);
    expect(sonnetAfter?.inputTokens).toBe(baseInputTokens + 50);
    expect(sonnetAfter?.outputTokens).toBe(baseOutputTokens + 60);
  });
});
