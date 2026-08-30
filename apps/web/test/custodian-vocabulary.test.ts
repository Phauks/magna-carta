/*
 * The register's words, pinned.
 *
 * A custody register is read by people who are answerable for what it describes, so the words are
 * not decoration: `superseded` is not `released`, `lost` is a state a firm records rather than an
 * absence, and a hold that read as advice would be a hold nobody respected. Each case below is a
 * word whose loss or softening would change what a reader believes about property they are
 * responsible for.
 */
import { describe, expect, it } from "vitest";
import {
  borrowerKindLabel,
  holdLabel,
  holdMeaning,
  itemStatusEntry,
  locationKindLabel,
  movementLabel,
  overdueBucketLabel,
  packetStatusEntry,
  OVERDUE_BUCKETS,
  PACKET_STATUSES,
  type CustodyHoldKind,
  type CustodyItemStatus,
  type CustodyMovementKind,
} from "../src/lib/custodian/custody-vocabulary.ts";

/*
 * The domain's own closed sets, copied here as the assertion's subject rather than imported: this
 * test exists to catch a word going missing from the SURFACE, and importing the same list the
 * surface reads would make it pass by construction. These are the values in
 * packages/custodian/src/types.ts.
 */
const MOVEMENT_KINDS: CustodyMovementKind[] = [
  "logged",
  "itemized",
  "moved",
  "checked_out",
  "returned",
  "withdrawn",
  "released",
  "superseded",
  "destroyed",
  "lost",
  "found",
  "reviewed",
  "hold_placed",
  "hold_released",
  "correction",
];

const HOLD_KINDS: CustodyHoldKind[] = [
  "legal",
  "discovery",
  "client_instruction",
  "dispute",
  "unclaimed",
];

const ITEM_STATUSES: CustodyItemStatus[] = [
  "held",
  "out",
  "released",
  "destroyed",
  "lost",
  "superseded",
];

describe("the packet and item vocabularies", () => {
  it("gives every packet status a word, a tone and a meaning", () => {
    for (const status of PACKET_STATUSES) {
      const entry = packetStatusEntry(status);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.meaning.length).toBeGreaterThan(0);
      expect(entry.presentation).toBe("chip");
    }
  });

  it("carries superseded on an item and nowhere else", () => {
    expect(itemStatusEntry("superseded").label).toBe("Superseded");
    expect(PACKET_STATUSES).not.toContain("superseded");
  });

  it("keeps every item status distinct", () => {
    const labels = ITEM_STATUSES.map((status) => itemStatusEntry(status).label);
    expect(new Set(labels).size).toBe(ITEM_STATUSES.length);
  });

  it("does not soften a loss into an absence", () => {
    // A register that cannot say "we cannot find this" is a register that gets quietly falsified at
    // exactly the moment accurate records matter most.
    expect(packetStatusEntry("lost").label).toBe("Lost");
    expect(packetStatusEntry("lost").tone).toBe("danger");
  });
});

describe("the movement vocabulary", () => {
  it("reads every kind as a completed act", () => {
    for (const kind of MOVEMENT_KINDS) {
      expect(movementLabel(kind).length).toBeGreaterThan(0);
    }
  });

  it("keeps a correction visible as a correction", () => {
    // This ledger has no edit path: a mistake is put right by appending a compensating row, and a
    // reader has to be able to see one for that to be worth anything.
    expect(movementLabel("correction")).toBe("Correction");
  });

  it("gives every kind its own words", () => {
    const labels = MOVEMENT_KINDS.map(movementLabel);
    expect(new Set(labels).size).toBe(MOVEMENT_KINDS.length);
  });
});

describe("the hold vocabulary", () => {
  it("names every kind", () => {
    for (const kind of HOLD_KINDS) expect(holdLabel(kind).length).toBeGreaterThan(0);
  });

  it("says what a hold forbids and what it does not, on every kind", () => {
    // A hold blocks property leaving the firm's custody or ceasing to exist. It deliberately does
    // not block a move, because a held original still has to be movable somewhere safer — and a
    // reader who did not know that would leave an original in a flooding basement.
    for (const kind of HOLD_KINDS) {
      const meaning = holdMeaning(kind);
      expect(meaning).toContain("cannot be released or destroyed");
      expect(meaning).toContain("can still be moved");
    }
  });
});

describe("the borrower and location vocabularies", () => {
  it("tells the three borrower shapes apart", () => {
    const labels = (["member", "entity", "external"] as const).map(borrowerKindLabel);
    expect(new Set(labels).size).toBe(3);
  });

  it("names every container kind, including the ones that are not the firm's offices", () => {
    expect(locationKindLabel("bank")).toBe("Bank");
    expect(locationKindLabel("offsite")).toBe("Offsite store");
    expect(locationKindLabel("safe")).toBe("Safe");
  });
});

describe("the overdue buckets", () => {
  it("renders each of the register's own buckets", () => {
    for (const bucket of OVERDUE_BUCKETS) {
      expect(overdueBucketLabel(bucket.key)).toBe(bucket.label);
    }
  });

  it("shows an unrecognized bucket rather than swallowing it", () => {
    // A bucket added upstream must be visible as itself rather than rendering blank, which would
    // read as a row with nothing wrong with it.
    expect(overdueBucketLabel("over-365d")).toBe("over-365d");
  });
});
