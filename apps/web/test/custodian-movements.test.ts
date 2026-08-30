/*
 * The chain of custody, pinned.
 *
 * A custody ledger's whole value in a dispute is that it is a contemporaneous record of who had
 * something and when. Every case here is a way that record could be presented so as to lose one of
 * those two facts — a movement rendered without a person, a borrower reduced to a handle, a release
 * shown without the authority it was made on, a back-dated entry that looks contemporaneous.
 */
import { describe, expect, it } from "vitest";
import {
  borrowerText,
  movementDetailLines,
  movementEvent,
  movementEvents,
  NAMES_UNRESOLVED,
  type CustodyNameLookup,
} from "../src/lib/custodian/custody-movements.ts";
import type { CustodyMovement } from "../src/lib/custodian/custody-api.ts";

function movement(overrides: Partial<CustodyMovement> = {}): CustodyMovement {
  return {
    id: "custodyMovement_one",
    itemId: null,
    kind: "moved",
    occurredAt: "2026-03-03T10:00:00.000Z",
    recordedAt: "2026-03-03T10:05:00.000Z",
    recordedByUserId: "user_chase",
    fromLocationId: null,
    toLocationId: null,
    borrowerKind: null,
    borrowerUserId: null,
    borrowerEntityId: null,
    borrowerName: null,
    dueBackOn: null,
    reason: null,
    correctsMovementId: null,
    shipmentId: null,
    note: null,
    releaseAuthorityBasis: null,
    releaseIdentityEvidence: null,
    releaseIdentityVerifiedByUserId: null,
    releaseWitnessedByUserId: null,
    ...overrides,
  };
}

const NAMES: CustodyNameLookup = {
  member: (userId) => (userId === "user_chase" ? "Marguerite Chase" : null),
  location: (locationId) => (locationId === "custodyLocation_safe" ? "Reno safe" : null),
  entity: (entityId) => (entityId === "directoryPerson_alvarez" ? "Rosa Alvarez" : null),
};

describe("who recorded a movement", () => {
  it("names the member the ledger row names", () => {
    expect(movementEvent(movement(), NAMES).source).toBe("Marguerite Chase");
  });

  it("states the gap rather than leaving the source blank", () => {
    // A blank there reads as a rendering fault. A history that cannot say who acted has to say that
    // it cannot, because the question a chain of custody is asked is exactly that one.
    expect(movementEvent(movement({ recordedByUserId: null }), NAMES).source).toBe("Not recorded");
    expect(movementEvent(movement(), NAMES_UNRESOLVED).source).toBe("Not recorded");
  });

  it("never renders the raw handle at a person", () => {
    const event = movementEvent(movement({ recordedByUserId: "user_departed" }), NAMES);
    expect(event.source).not.toContain("user_");
  });

  it("is dated by when it happened, not by when it was typed in", () => {
    const event = movementEvent(
      movement({ occurredAt: "2026-03-01T09:00:00.000Z", recordedAt: "2026-03-09T09:00:00.000Z" }),
      NAMES,
    );
    expect(event.at).toBe("2026-03-01T09:00:00.000Z");
  });

  it("says when an entry was made well after the event", () => {
    // Back-dating is legitimate and routine — custody events happen on a Friday and get entered on
    // a Monday — but the gap is what a reviewer is looking at, so it is on the record and visible.
    const lines = movementDetailLines(
      movement({ occurredAt: "2026-03-01T09:00:00.000Z", recordedAt: "2026-03-09T09:00:00.000Z" }),
      NAMES,
    );
    expect(lines).toContain("Entered 8 days after it happened");
  });

  it("says nothing about a gap when there is none", () => {
    const lines = movementDetailLines(movement(), NAMES);
    expect(lines.join(" ")).not.toContain("after it happened");
  });
});

describe("who has it", () => {
  it("names a member borrower", () => {
    const said = borrowerText(
      movement({ kind: "checked_out", borrowerKind: "member", borrowerUserId: "user_chase" }),
      NAMES,
    );
    expect(said).toBe("Marguerite Chase");
  });

  it("names a directory borrower", () => {
    const said = borrowerText(
      movement({
        kind: "checked_out",
        borrowerKind: "entity",
        borrowerEntityId: "directoryPerson_alvarez",
      }),
      NAMES,
    );
    expect(said).toBe("Rosa Alvarez");
  });

  it("keeps an external borrower's own recorded name", () => {
    // A courier's named driver is deliberately not in the directory: the directory is the conflicts
    // corpus, and writing a driver into it has a real downstream cost. The name on the row is all
    // there is, and it is the answer.
    const said = borrowerText(
      movement({ kind: "checked_out", borrowerKind: "external", borrowerName: "T. Okafor" }),
      NAMES,
    );
    expect(said).toBe("T. Okafor");
  });

  it("falls back to the KIND of borrower rather than to a handle", () => {
    const said = borrowerText(
      movement({
        kind: "checked_out",
        borrowerKind: "entity",
        borrowerEntityId: "directoryPerson_x",
      }),
      NAMES,
    );
    expect(said).toBe("Someone in the directory");
    expect(said).not.toContain("directoryPerson_");
  });

  it("says nothing where the row names nobody", () => {
    expect(borrowerText(movement(), NAMES)).toBeNull();
  });
});

describe("what a check-out and a release put on the record", () => {
  it("carries the borrower and the due-back date", () => {
    const lines = movementDetailLines(
      movement({
        kind: "checked_out",
        borrowerKind: "member",
        borrowerUserId: "user_chase",
        dueBackOn: "2026-03-20",
      }),
      NAMES,
    );
    expect(lines).toContain("With Marguerite Chase");
    expect(lines).toContain("Due back 2026-03-20");
  });

  it("says who collected the property on a release, not who has it", () => {
    const lines = movementDetailLines(
      movement({ kind: "released", borrowerKind: "external", borrowerName: "T. Okafor" }),
      NAMES,
    );
    expect(lines).toContain("Collected by T. Okafor");
  });

  it("quotes the authority a release was made on and who checked identity", () => {
    const lines = movementDetailLines(
      movement({
        kind: "released",
        borrowerKind: "external",
        borrowerName: "T. Okafor",
        releaseAuthorityBasis: "Grant of probate dated 4 February 2026",
        releaseIdentityEvidence: "Passport checked against the grant",
        releaseIdentityVerifiedByUserId: "user_chase",
      }),
      NAMES,
    ).join(" | ");
    expect(lines).toContain("Grant of probate dated 4 February 2026");
    expect(lines).toContain("Identity checked by Marguerite Chase");
  });

  it("names a witness where the firm required a second signatory", () => {
    const lines = movementDetailLines(
      movement({ kind: "released", releaseWitnessedByUserId: "user_chase" }),
      NAMES,
    );
    expect(lines).toContain("Witnessed by Marguerite Chase");
  });

  it("shows a move between two named nodes", () => {
    const lines = movementDetailLines(movement({ toLocationId: "custodyLocation_safe" }), NAMES);
    expect(lines).toContain("To Reno safe");
  });

  it("marks a correction as one", () => {
    const lines = movementDetailLines(
      movement({ kind: "correction", correctsMovementId: "custodyMovement_earlier" }),
      NAMES,
    );
    expect(lines).toContain("Corrects an earlier entry on this packet");
  });
});

describe("the ledger as a whole", () => {
  it("keeps the order it was handed, one event per row", () => {
    const rows = [movement({ id: "custodyMovement_two" }), movement({ id: "custodyMovement_one" })];
    expect(movementEvents(rows, NAMES).map((event) => event.id)).toEqual([
      "custodyMovement_two",
      "custodyMovement_one",
    ]);
  });

  it("leaves a bare movement with no detail rather than an empty quotation", () => {
    expect(movementEvent(movement(), NAMES).detail).toBeUndefined();
  });
});
