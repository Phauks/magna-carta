import { newIdentifier } from "@magna-carta/identifiers/generate";
import { describe, expect, it } from "vitest";
import { fixtureContext } from "../src/context.ts";
import { assertSeedingAllowed } from "../src/guard.ts";

describe("FixtureContext — one seed carries all determinism (ADR-0034)", () => {
  it("same seed → identical ids, names, and clock readings", () => {
    const a = fixtureContext("demo-llp-1");
    const b = fixtureContext("demo-llp-1");
    // Two draws each: byte-identical replay is a SEQUENCE property, not a first-element property.
    expect(newIdentifier("ledgerAccount", a.randomSource)).toBe(
      newIdentifier("ledgerAccount", b.randomSource),
    );
    expect(newIdentifier("ledgerLine", a.randomSource)).toBe(
      newIdentifier("ledgerLine", b.randomSource),
    );
    expect(a.faker.person.fullName()).toBe(b.faker.person.fullName());
    expect(a.faker.person.fullName()).toBe(b.faker.person.fullName());
    expect(a.clock.now()).toBe(b.clock.now());
  });

  it("different seeds diverge", () => {
    const a = fixtureContext("demo-llp-1");
    const b = fixtureContext("demo-llp-2");
    expect(newIdentifier("ledgerAccount", a.randomSource)).not.toBe(
      newIdentifier("ledgerAccount", b.randomSource),
    );
  });

  it("the fixed clock starts at the anchor and advances only explicitly", () => {
    const context = fixtureContext("demo-llp-1");
    expect(context.clock.now()).toBe("2026-01-05T09:00:00.000Z");
    expect(context.clock.today()).toBe("2026-01-05");
    context.clock.advanceMinutes(90);
    expect(context.clock.now()).toBe("2026-01-05T10:30:00.000Z");
    context.clock.advanceMinutes(24 * 60); // across midnight
    expect(context.clock.today()).toBe("2026-01-06");
  });

  it("guard refuses without the explicit opt-in", () => {
    expect(() => assertSeedingAllowed({ allowSeeding: false })).toThrow(/seeding/i);
    expect(() => assertSeedingAllowed({ allowSeeding: true })).not.toThrow();
  });

  it("local database helper stands up the per-firm schema", async () => {
    const { createLocalPerFirmDatabase } = await import("../src/local-database.ts");
    const { raw } = createLocalPerFirmDatabase();
    const tables = raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        "ledger_account",
        "ledger_entry",
        "ledger_line",
        "account_balance",
        "outbox",
      ]),
    );
  });
});
