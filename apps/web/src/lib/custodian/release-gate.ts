/*
 * What stands between a packet and the two acts it never comes back from: releasing the property to
 * somebody, and destroying it.
 *
 * WHY A SCREEN COMPUTES THIS AT ALL. The refusals are the server's — packages/custodian's hold
 * service, release gate and destruction service enforce every one of them, and a screen that
 * decided otherwise would be wrong rather than permissive. What a screen owes the reader is the
 * REASON, stated before the act rather than as a refusal afterwards. A firm holding an original will
 * is answerable for it; "Release" greyed out with nothing said is the shape of a defect, and a
 * person who cannot see why will find another way round.
 *
 * So every entry below is one refusal the server already makes, worded for the person looking at
 * the packet, and each one names the thing that would have to change for the act to become
 * available. Nothing here is advisory and nothing here is a policy this file invented.
 *
 * THE ONE REFUSAL WITH NO WAY PAST. An item a person has marked as an irreplaceable original is
 * never destructible. There is no override parameter, no privileged caller and no second endpoint —
 * the only route past it is a person clearing that flag on that object, which is a change to a fact
 * rather than a way round a rule. The wording says exactly that, because a reader who believes
 * there is a button somewhere will go looking for one.
 */
import { holdLabel, type CustodyPacketStatus } from "./custody-vocabulary.ts";
import type { CustodyHold, CustodyItem } from "./custody-api.ts";

/** One reason an act is refused, and what would have to change. */
export interface CustodyRefusal {
  /** Stable identity, so a list of refusals renders without inventing keys. */
  readonly key: string;
  /** The reason, in one sentence, addressed to the person looking at the packet. */
  readonly reason: string;
}

/** What the two irreversible acts stand on right now. */
export interface CustodyGateVerdict {
  /** Empty when the act is available; otherwise every reason it is not, in reading order. */
  readonly refusals: readonly CustodyRefusal[];
  /** True when nothing refuses it. */
  readonly permitted: boolean;
}

/** The holds still standing. A released hold constrains nothing and is history. */
export function holdsInForce(holds: readonly CustodyHold[]): readonly CustodyHold[] {
  return holds.filter((hold) => hold.releasedAt === null);
}

/** A closed record: the property has left, ceased to exist, or cannot be found. */
const CLOSED_STATUSES: ReadonlySet<CustodyPacketStatus> = new Set([
  "released",
  "destroyed",
  "lost",
]);

function closedRecordRefusal(status: CustodyPacketStatus, act: string): CustodyRefusal | null {
  if (!CLOSED_STATUSES.has(status)) return null;
  const said =
    status === "released"
      ? "This packet has already been released."
      : status === "destroyed"
        ? "This packet has already been destroyed."
        : "This packet is recorded as lost.";
  return {
    key: `closed-${status}`,
    reason: `${said} A closed record can't be moved, only corrected, so it can't be ${act}. To fix a movement recorded wrongly, add a correction.`,
  };
}

function holdRefusals(holds: readonly CustodyHold[], act: string): CustodyRefusal[] {
  return holdsInForce(holds).map((hold) => ({
    key: `hold-${hold.id}`,
    reason:
      `${holdLabel(hold.kind)} placed on this packet: it cannot be ${act} while the hold stands. ` +
      (hold.reason === null
        ? "No reason was recorded with the hold."
        : `Recorded reason: ${hold.reason}`),
  }));
}

/**
 * Whether this packet can be released, and what says otherwise.
 *
 * A hold forbids property LEAVING the firm's custody or ceasing to exist. It deliberately does not
 * forbid a move, because a held original still has to be movable to a fireproof safe, so nothing
 * here refuses a relocation.
 */
export function releaseVerdict(packet: {
  readonly status: CustodyPacketStatus;
  readonly holds: readonly CustodyHold[];
}): CustodyGateVerdict {
  const refusals: CustodyRefusal[] = [];
  const closed = closedRecordRefusal(packet.status, "released");
  if (closed !== null) refusals.push(closed);
  refusals.push(...holdRefusals(packet.holds, "released"));
  return { refusals, permitted: refusals.length === 0 };
}

/**
 * Whether this packet can be destroyed, and what says otherwise.
 *
 * A packet-scoped destruction is refused when ANY item in it is an irreplaceable original, which is
 * why the flag is checked over the whole set rather than one item at a time.
 */
export function destructionVerdict(packet: {
  readonly status: CustodyPacketStatus;
  readonly holds: readonly CustodyHold[];
  readonly items: readonly CustodyItem[];
}): CustodyGateVerdict {
  const refusals: CustodyRefusal[] = [];
  const closed = closedRecordRefusal(packet.status, "destroyed");
  if (closed !== null) refusals.push(closed);
  refusals.push(...holdRefusals(packet.holds, "destroyed"));

  const irreplaceable = packet.items.filter((item) => item.intrinsicValue);
  if (irreplaceable.length > 0) {
    refusals.push({
      key: "intrinsic-value",
      reason:
        `${irreplaceable.length === 1 ? "One item in this packet is" : `${irreplaceable.length} items in this packet are`} marked as an irreplaceable original, so the packet can't be destroyed. ` +
        "There is no override. Someone has to clear that mark on the item first.",
    });
  }
  return { refusals, permitted: refusals.length === 0 };
}

/**
 * The sentence a disabled control carries, given a verdict.
 *
 * One line, because it is a hover and a control's accessible description. The full list of reasons
 * is drawn on the packet where it has room; this is what somebody reading with a screen reader or
 * resting on the control is told.
 */
export function refusalSummary(verdict: CustodyGateVerdict): string | undefined {
  if (verdict.permitted) return undefined;
  const [first] = verdict.refusals;
  if (first === undefined) return undefined;
  if (verdict.refusals.length === 1) return first.reason;
  return `${first.reason} And ${verdict.refusals.length - 1} more reason${verdict.refusals.length === 2 ? "" : "s"}, listed on the packet.`;
}
