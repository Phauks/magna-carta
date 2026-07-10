import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "../src/effect-batch.ts";
import { expect, test } from "vitest";
import { IdempotencyConflictError, runDomainEffect } from "../src/run-domain-effect.ts";

const clock = { now: () => "2026-07-09T00:00:00.000Z" };

function database(): BatchDatabase {
  const { database } = createMigratedNodeDatabase("per-firm");
  return database as unknown as BatchDatabase;
}

test("an executed effect returns the built value and idempotentReplay false", async () => {
  const outcome = await runDomainEffect(database(), undefined, clock, "test", () => ({
    statements: [],
    outboxMessages: [],
    responseCode: 201,
    responseBody: { id: "x_1" },
    value: "x_1",
    fromBody: (body) => (body as { id: string }).id,
  }));
  expect(outcome.value).toBe("x_1");
  expect(outcome.idempotentReplay).toBe(false);
});

test("a replayed key recovers the value through fromBody and flags the replay", async () => {
  const db = database();
  const idempotency = { key: "firm:k:1", fingerprint: "fp" };
  const first = await runDomainEffect(db, idempotency, clock, "test", () => ({
    statements: [],
    outboxMessages: [],
    responseCode: 201,
    responseBody: { id: "x_1" },
    value: "x_1",
    fromBody: (body) => (body as { id: string }).id,
  }));
  const second = await runDomainEffect(db, idempotency, clock, "test", () => ({
    statements: [],
    outboxMessages: [],
    responseCode: 201,
    responseBody: { id: "x_1" },
    value: "x_1",
    fromBody: (body) => (body as { id: string }).id,
  }));
  expect(first.idempotentReplay).toBe(false);
  expect(second.idempotentReplay).toBe(true);
  expect(second.value).toBe("x_1");
});

test("a fingerprint mismatch throws IdempotencyConflictError carrying the domain", async () => {
  const db = database();
  await runDomainEffect(db, { key: "firm:k:1", fingerprint: "fp-a" }, clock, "test", () => ({
    statements: [],
    outboxMessages: [],
    responseCode: 201,
    responseBody: { id: "x_1" },
    value: "x_1",
    fromBody: (body) => (body as { id: string }).id,
  }));
  await expect(
    runDomainEffect(db, { key: "firm:k:1", fingerprint: "fp-b" }, clock, "test", () => ({
      statements: [],
      outboxMessages: [],
      responseCode: 201,
      responseBody: { id: "x_2" },
      value: "x_2",
      fromBody: (body) => (body as { id: string }).id,
    })),
  ).rejects.toMatchObject({ domain: "test", kind: "fingerprint-mismatch" });
  await expect(
    runDomainEffect(db, { key: "firm:k:1", fingerprint: "fp-b" }, clock, "test", () => ({
      statements: [],
      outboxMessages: [],
      responseCode: 201,
      responseBody: { id: "x_2" },
      value: "x_2",
      fromBody: (body) => (body as { id: string }).id,
    })),
  ).rejects.toBeInstanceOf(IdempotencyConflictError);
});
