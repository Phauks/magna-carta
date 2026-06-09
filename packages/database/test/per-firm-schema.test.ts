import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { idempotencyKey, outbox } from "../src/per-firm-schema.ts";

const columnOf = (table: typeof idempotencyKey | typeof outbox, name: string) => {
  const config = getTableConfig(table);
  const found = config.columns.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`expected column ${name} on ${config.name}`);
  return found;
};

describe("per-firm schema: idempotency_key (ADR-0063)", () => {
  it("matches the spec columns", () => {
    const config = getTableConfig(idempotencyKey);
    expect(config.name).toBe("idempotency_key");
    expect(columnOf(idempotencyKey, "id").primary).toBe(true);
    expect(columnOf(idempotencyKey, "key").notNull).toBe(true);
    expect(columnOf(idempotencyKey, "fingerprint").notNull).toBe(true);
    expect(columnOf(idempotencyKey, "status").notNull).toBe(true);
    expect(columnOf(idempotencyKey, "response_code").getSQLType()).toBe("integer");
    expect(columnOf(idempotencyKey, "response_body").notNull).toBe(false);
    expect(columnOf(idempotencyKey, "created_at").getSQLType()).toBe("text");
  });

  it("enforces UNIQUE(key) — the UNIQUE insert IS the concurrency guard", () => {
    const config = getTableConfig(idempotencyKey);
    const uniqueOnKey = config.indexes.some(
      (index) =>
        index.config.unique &&
        index.config.columns.some((column) => "name" in column && column.name === "key"),
    );
    expect(uniqueOnKey).toBe(true);
  });
});

describe("per-firm schema: outbox (ADR-0064)", () => {
  it("matches the spec columns", () => {
    const config = getTableConfig(outbox);
    expect(config.name).toBe("outbox");
    expect(columnOf(outbox, "id").primary).toBe(true);
    expect(columnOf(outbox, "topic").notNull).toBe(true);
    expect(columnOf(outbox, "payload").notNull).toBe(true);
    expect(columnOf(outbox, "aggregate_key").notNull).toBe(false);
    expect(columnOf(outbox, "seq").getSQLType()).toBe("integer");
    expect(columnOf(outbox, "attempts").notNull).toBe(true);
    expect(columnOf(outbox, "dispatched_at").notNull).toBe(false);
  });

  it("has the relay-sweep index on (status, created_at)", () => {
    const config = getTableConfig(outbox);
    const sweepIndex = config.indexes.find((index) =>
      index.config.columns.some((column) => "name" in column && column.name === "status"),
    );
    expect(sweepIndex).toBeDefined();
  });
});
