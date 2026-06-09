import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { firm } from "../src/control-plane-schema.ts";

describe("control-plane schema: firm registry", () => {
  const config = getTableConfig(firm);
  const column = (name: string) => {
    const found = config.columns.find((candidate) => candidate.name === name);
    if (!found) throw new Error(`expected column ${name} on ${config.name}`);
    return found;
  };

  it("is the firm table with a firm_ handle TEXT primary key", () => {
    expect(config.name).toBe("firm");
    expect(column("id").primary).toBe(true);
    expect(column("id").getSQLType()).toBe("text");
  });

  it("tracks the backing D1 database and the mirrored per-firm schema version", () => {
    expect(column("database_identifier").notNull).toBe(true);
    expect(column("database_identifier").isUnique).toBe(true);
    expect(column("per_firm_schema_version").notNull).toBe(false); // null = not yet provisioned
    expect(column("created_at").getSQLType()).toBe("text"); // ISO-8601 instant (ADR-0055)
  });
});
