/*
 * Which trust account the matter's Trust section opens on.
 *
 * This is the one rule the whole section's shape follows from: it decides which ledger is read,
 * which queue is read, and what every write on the surface is posted into. Getting it wrong shows
 * up as a matter that appears to hold no client money — which is indistinguishable, on screen, from
 * a matter that genuinely holds none. So the rule is a pure function and it is pinned here.
 */
import { describe, expect, it } from "vitest";
import {
  chooseTrustAccount,
  trustAccountPreference,
  trustAccountsInPickingOrder,
} from "../src/lib/trust/trust-account-choice.ts";
import type { TrustAccountListing } from "../src/lib/trust/trust-api.ts";

function account(
  id: string,
  name: string,
  status: "open" | "closed" = "open",
): TrustAccountListing {
  return {
    id,
    name,
    locationId: "location_main",
    jurisdiction: "US-CA",
    bankName: "First Bank",
    accountNumberLastFour: "4417",
    currency: "USD",
    iolta: true,
    status,
    openedOn: "2024-03-01",
    closedAt: status === "closed" ? "2025-11-30T00:00:00.000Z" : null,
    timeZone: "America/Los_Angeles",
  };
}

describe("choosing the account a matter's trust ledger is read against", () => {
  it("takes the firm's one open account without asking", () => {
    expect(chooseTrustAccount([account("trust_one", "Client Trust")], null)).toBe("trust_one");
  });

  it("answers nothing where the firm has opened no trust account", () => {
    expect(chooseTrustAccount([], null)).toBeNull();
    expect(chooseTrustAccount([], "trust_remembered")).toBeNull();
  });

  it("takes the first OPEN account by name where nothing is remembered", () => {
    const roster = [
      account("trust_westward", "Westward Office Trust"),
      account("trust_bay", "Bay Office Trust"),
    ];
    expect(chooseTrustAccount(roster, null)).toBe("trust_bay");
  });

  it("never chooses a closed account for somebody who has not asked for one", () => {
    const roster = [
      account("trust_archive", "Archive Trust", "closed"),
      account("trust_bay", "Bay Office Trust"),
    ];
    // Alphabetically first, and closed: a matter's history may sit there, but nothing can be
    // posted into it, so it is pickable and never the default.
    expect(chooseTrustAccount(roster, null)).toBe("trust_bay");
  });

  it("answers nothing where every account on the roster is closed", () => {
    const roster = [account("trust_archive", "Archive Trust", "closed")];
    expect(chooseTrustAccount(roster, null)).toBeNull();
  });

  it("takes the reader's remembered account, including one they closed", () => {
    const roster = [
      account("trust_bay", "Bay Office Trust"),
      account("trust_archive", "Archive Trust", "closed"),
    ];
    expect(chooseTrustAccount(roster, "trust_archive")).toBe("trust_archive");
  });

  it("falls back where the remembered account is no longer on the roster", () => {
    const roster = [account("trust_bay", "Bay Office Trust")];
    expect(chooseTrustAccount(roster, "trust_gone")).toBe("trust_bay");
  });

  it("offers the accounts by name, so a picker is scannable", () => {
    const roster = [
      account("trust_westward", "Westward Office Trust"),
      account("trust_archive", "Archive Trust", "closed"),
      account("trust_bay", "Bay Office Trust"),
    ];
    expect(trustAccountsInPickingOrder(roster).map((one) => one.id)).toEqual([
      "trust_archive",
      "trust_bay",
      "trust_westward",
    ]);
  });
});

describe("where the chosen account is remembered", () => {
  it("round-trips an identifier and folds an absent one to nothing remembered", () => {
    const codec = trustAccountPreference();
    expect(codec.storageKey).toBe("magna-carta-trust-account");
    expect(codec.decode(codec.encode("trust_bay"))).toBe("trust_bay");
    expect(codec.decode(null)).toBeNull();
    expect(codec.decode("")).toBeNull();
  });
});
