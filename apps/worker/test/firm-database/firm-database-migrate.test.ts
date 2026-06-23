import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { FirmDatabase } from "../../src/firm-database/firm-database-object.ts";

describe("FirmDatabase", () => {
  it("self-migrates the per-firm lineage on wake", async () => {
    const stub = env.FIRM_DATABASE.get(env.FIRM_DATABASE.idFromName("firm_x"));
    const tables = await runInDurableObject(stub, (instance: FirmDatabase) =>
      instance.tableCountForTest(),
    );
    expect(tables).toBeGreaterThan(10);
  });
});
