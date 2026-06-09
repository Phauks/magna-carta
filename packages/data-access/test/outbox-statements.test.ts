import { describe, expect, it } from "vitest";
import { insertOutboxMessageStatement } from "../src/outbox-statements.ts";
import { stubD1 } from "./support/stub-d1.ts";

describe("insertOutboxMessageStatement", () => {
  it("mints an obx_ handle, serializes the payload canonically, and binds the aggregate key", () => {
    const stub = stubD1();
    const statement = insertOutboxMessageStatement(
      stub.database,
      { topic: "payment.capture", payload: { b: 2, a: 1 }, aggregateKey: "led_x" },
      "2026-06-09T00:00:00.000Z",
    );
    expect(statement.sql).toContain("INSERT INTO outbox");
    expect(statement.sql).toContain("'pending'");
    const [id, topic, payload, aggregateKey, createdAt] = statement.bindings;
    expect(id).toMatch(/^obx_[A-Za-z0-9_-]{21}$/);
    expect(topic).toBe("payment.capture");
    expect(payload).toBe('{"a":1,"b":2}'); // canonical JSON — key order normalized
    expect(aggregateKey).toBe("led_x");
    expect(createdAt).toBe("2026-06-09T00:00:00.000Z");
  });

  it("computes seq in-SQL per aggregate (subselect), NULL when there is no aggregate key", () => {
    const stub = stubD1();
    const ordered = insertOutboxMessageStatement(
      stub.database,
      { topic: "t", payload: {}, aggregateKey: "mat_x" },
      "2026-06-09T00:00:00.000Z",
    );
    // The seq expression lives in the SQL, not the bindings — batch statements cannot share JS results.
    expect(ordered.sql).toContain("SELECT COALESCE(MAX(seq), -1) + 1 FROM outbox");
    expect(ordered.sql).toContain("CASE WHEN ?4 IS NULL THEN NULL");
    const unordered = insertOutboxMessageStatement(
      stub.database,
      { topic: "t", payload: {} },
      "2026-06-09T00:00:00.000Z",
    );
    expect(unordered.bindings[3]).toBeNull(); // no aggregate -> NULL seq via the CASE arm
  });
});
