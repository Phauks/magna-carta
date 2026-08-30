/*
 * A packet's chain of custody, as the platform's one history presentation reads it.
 *
 * WHAT A MOVEMENT ROW HAS TO SAY, EVERY TIME: who, and when. A custody ledger's whole value in a
 * dispute is that it is a contemporaneous record — "the packet was checked out to Ms. Alvarez on 3
 * March and returned on 11 March" is worth something because nobody could have made it say
 * otherwise afterwards. An event that renders the act and drops the person is a history that cannot
 * answer the question it exists for, so `source` is always filled: the member who recorded it where
 * the row names one, and the register's own statement that nobody was recorded where it does not.
 *
 * TWO INSTANTS, AND BOTH ARE SHOWN. `occurredAt` is when it happened in the physical world and is
 * what the rail is ordered and dated by; `recordedAt` is when somebody typed it in. They are
 * separate columns on purpose — custody events happen on a Friday and get entered on a Monday, and
 * collapsing them would make back-dating either impossible or indistinguishable from falsification.
 * Where the two differ by more than a working day the event says so, because that gap is exactly
 * what a reviewer is looking at.
 *
 * The rail itself renders the order it is handed. The ledger arrives newest-first, so a caller
 * hands the result of `movementEvents` through the rail's own `orderedOldestFirst`.
 */
import { personName, UNRECORDED_PERSON } from "@magna-carta/design-system/formatters";
import type { EventRailEvent } from "@magna-carta/design-system/event-rail";
import { borrowerKindLabel, movementLabel } from "./custody-vocabulary.ts";
import type { CustodyMovement } from "./custody-api.ts";

/**
 * How a surface turns the handles on a ledger row into words. Each returns null where nothing
 * answers, and never the handle itself: printing `user_01J…` at a person is not an answer.
 */
export interface CustodyNameLookup {
  /** A firm member, by user handle. */
  member: (userId: string) => string | null;
  /** A node of the container tree, by location handle. */
  location: (locationId: string) => string | null;
  /** A directory person or organization, by entity handle. */
  entity: (entityId: string) => string | null;
}

/** A lookup that names nothing — what a surface holds before its vocabularies land. */
export const NAMES_UNRESOLVED: CustodyNameLookup = {
  member: () => null,
  location: () => null,
  entity: () => null,
};

/** How many days apart the two instants may sit before the gap is worth stating. */
const BACKDATING_NOTICE_DAYS = 1;

const MILLISECONDS_PER_DAY = 86_400_000;

/** Whole days between two instants, or null where either is unreadable. */
function daysBetween(earlier: string, later: string): number | null {
  const from = Date.parse(earlier);
  const to = Date.parse(later);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.floor((to - from) / MILLISECONDS_PER_DAY);
}

/** Who has it, on a check-out or a release. Null where the row names nobody. */
export function borrowerText(movement: CustodyMovement, names: CustodyNameLookup): string | null {
  if (movement.borrowerKind === null) return null;
  switch (movement.borrowerKind) {
    case "member": {
      const named = movement.borrowerUserId === null ? null : names.member(movement.borrowerUserId);
      return named ?? borrowerKindLabel("member");
    }
    case "entity": {
      const named =
        movement.borrowerEntityId === null ? null : names.entity(movement.borrowerEntityId);
      return named ?? borrowerKindLabel("entity");
    }
    case "external":
      return personName(movement.borrowerName);
  }
  // A borrower shape the register grows later has no reading here yet, and saying nothing is more
  // honest than guessing at one.
  return null;
}

/** Where it went, as far as the row and the tree can say. */
function locationText(locationId: string | null, names: CustodyNameLookup): string | null {
  if (locationId === null) return null;
  return names.location(locationId);
}

/**
 * Everything recorded alongside one movement, as the sentences a reader needs beneath it.
 *
 * Order is fixed and it is the order the questions get asked: who has it, when it is due back,
 * where it went, what a release stood on, then whatever anyone wrote in their own words. A
 * correction names the row it corrects, because a compensating entry that did not would leave the
 * ledger contradicting itself with no way to tell which row is the later truth.
 */
export function movementDetailLines(movement: CustodyMovement, names: CustodyNameLookup): string[] {
  const lines: string[] = [];

  const borrower = borrowerText(movement, names);
  if (borrower !== null) {
    lines.push(movement.kind === "released" ? `Collected by ${borrower}` : `With ${borrower}`);
  }
  if (movement.dueBackOn !== null) lines.push(`Due back ${movement.dueBackOn}`);

  const from = locationText(movement.fromLocationId, names);
  const to = locationText(movement.toLocationId, names);
  if (from !== null && to !== null) lines.push(`From ${from} to ${to}`);
  else if (to !== null) lines.push(`To ${to}`);
  else if (from !== null) lines.push(`From ${from}`);

  // The release capture. It is the answer to the two questions asked after an original leaves, and
  // it is frozen on an append-only row, so it is quoted rather than summarized.
  if (movement.releaseAuthorityBasis !== null) {
    lines.push(`Released on the authority of: ${movement.releaseAuthorityBasis}`);
  }
  if (movement.releaseIdentityEvidence !== null) {
    const verifier =
      movement.releaseIdentityVerifiedByUserId === null
        ? null
        : names.member(movement.releaseIdentityVerifiedByUserId);
    lines.push(
      `Identity checked${verifier === null ? "" : ` by ${verifier}`}: ${movement.releaseIdentityEvidence}`,
    );
  }
  if (movement.releaseWitnessedByUserId !== null) {
    const witness = names.member(movement.releaseWitnessedByUserId);
    lines.push(`Witnessed by ${witness ?? UNRECORDED_PERSON}`);
  }

  if (movement.correctsMovementId !== null) lines.push("Corrects an earlier entry on this packet");
  if (movement.shipmentId !== null) lines.push("Carried by a recorded shipment");
  if (movement.reason !== null) lines.push(movement.reason);
  if (movement.note !== null) lines.push(movement.note);

  const gap = daysBetween(movement.occurredAt, movement.recordedAt);
  if (gap !== null && gap > BACKDATING_NOTICE_DAYS) {
    lines.push(`Entered ${gap} days after it happened`);
  }

  return lines;
}

/** One ledger row as the rail presents it. */
export function movementEvent(movement: CustodyMovement, names: CustodyNameLookup): EventRailEvent {
  const detail = movementDetailLines(movement, names).join(". ");
  const recorded =
    movement.recordedByUserId === null ? null : names.member(movement.recordedByUserId);
  return {
    id: movement.id,
    action: movementLabel(movement.kind),
    at: movement.occurredAt,
    // Always filled. A history that leaves out who acted cannot answer what a chain of custody is
    // asked, and a blank there reads as a rendering fault rather than as the gap it is.
    source: personName(recorded),
    ...(detail === "" ? {} : { detail }),
  };
}

/** A packet's ledger as the rail presents it, in the order it was handed over. */
export function movementEvents(
  movements: readonly CustodyMovement[],
  names: CustodyNameLookup,
): EventRailEvent[] {
  return movements.map((movement) => movementEvent(movement, names));
}
