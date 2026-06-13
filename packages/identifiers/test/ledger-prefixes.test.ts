import { describe, expect, it } from "vitest";
import { newIdentifier } from "../src/generate.ts";
import { ENTITY_PREFIXES } from "../src/registry.ts";
import type { LedgerAccountId, LedgerLineId } from "../src/types.ts";

describe("ledger identifier prefixes", () => {
  it("registers the ledgerAccount and ledgerLine prefixes", () => {
    expect(ENTITY_PREFIXES.ledgerAccount).toBe("ledgerAccount");
    expect(ENTITY_PREFIXES.ledgerLine).toBe("ledgerLine");
  });

  it("mints handles with the full-name prefixes and the branded aliases compile", () => {
    const accountId: LedgerAccountId = newIdentifier("ledgerAccount");
    const lineId: LedgerLineId = newIdentifier("ledgerLine");
    expect(accountId).toMatch(/^ledgerAccount_[A-Za-z0-9_-]{21}$/);
    expect(lineId).toMatch(/^ledgerLine_[A-Za-z0-9_-]{21}$/);
  });
});
