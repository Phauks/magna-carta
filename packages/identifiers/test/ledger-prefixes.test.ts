import { describe, expect, it } from "vitest";
import { newIdentifier } from "../src/generate.ts";
import { ENTITY_PREFIXES } from "../src/registry.ts";
import type { LedgerAccountId, LedgerLineId } from "../src/types.ts";

describe("ledger identifier prefixes", () => {
  it("registers acct and lln prefixes", () => {
    expect(ENTITY_PREFIXES.ledgerAccount).toBe("acct");
    expect(ENTITY_PREFIXES.ledgerLine).toBe("lln");
  });

  it("mints handles with the new prefixes and the branded aliases compile", () => {
    const accountId: LedgerAccountId = newIdentifier("ledgerAccount");
    const lineId: LedgerLineId = newIdentifier("ledgerLine");
    expect(accountId).toMatch(/^acct_[A-Za-z0-9_-]{21}$/);
    expect(lineId).toMatch(/^lln_[A-Za-z0-9_-]{21}$/);
  });
});
