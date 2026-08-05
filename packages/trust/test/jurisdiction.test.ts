import { describe, expect, it } from "vitest";
import { loadTrustAccount } from "../src/account-tree.ts";
import {
  refusingTrustJurisdictions,
  requireTrustJurisdiction,
  resolveTrustRequirement,
  TRUST_JURISDICTION_REQUIREMENTS,
} from "../src/jurisdiction.ts";
import { trustFixture } from "./support.ts";

describe("the jurisdiction seam refuses rather than guessing", () => {
  it("refuses every requirement for every jurisdiction until a reviewed corpus is bound", () => {
    for (const requirement of TRUST_JURISDICTION_REQUIREMENTS) {
      expect(() => refusingTrustJurisdictions.resolve("US-NV", requirement)).toThrowError(
        /jurisdiction-not-encoded|no reviewed rules/,
      );
    }
  });

  it("distinguishes an unrecorded jurisdiction from an unencoded one", async () => {
    const fixture = await trustFixture();
    const account = await loadTrustAccount(fixture.database, fixture.trustAccountId);
    // The office recorded no jurisdiction: nothing to resolve AGAINST. Fixed by recording the
    // office's state, not by researching a jurisdiction — so it is a different refusal, and
    // conflating the two is exactly the mistake that tells a firm its obligations are optional.
    expect(() => requireTrustJurisdiction(account)).toThrowError(/no jurisdiction recorded/);
    try {
      requireTrustJurisdiction(account);
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("jurisdiction-not-recorded");
    }

    const encoded = { ...account, jurisdiction: "US-NV" };
    try {
      resolveTrustRequirement(refusingTrustJurisdictions, encoded, "unclaimedFunds");
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("jurisdiction-not-encoded");
    }
  });
});
