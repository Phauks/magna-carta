import { labelFor } from "./label.ts";
import type { ExhibitScheme } from "./scheme.ts";

// What a proposed reorder does to labels, computed before anything is saved. The screen shows it as
// "3 labels change: C to A, A to B, B to C", and a reorder is allowed to be casual only because this
// says out loud what it is about to move. Pure: two orders and a scheme in, the moves out.

export interface LabelMove<Identifier extends string> {
  readonly memberId: Identifier;
  readonly from: string;
  readonly to: string;
}

export function labelMoves<Identifier extends string>(
  currentOrder: readonly Identifier[],
  proposedOrder: readonly Identifier[],
  scheme: ExhibitScheme,
): LabelMove<Identifier>[] {
  const currentPosition = new Map(currentOrder.map((memberId, index) => [memberId, index + 1]));
  const moves: LabelMove<Identifier>[] = [];
  proposedOrder.forEach((memberId, index) => {
    const before = currentPosition.get(memberId);
    if (before === undefined || before === index + 1) return;
    moves.push({ memberId, from: labelFor(before, scheme), to: labelFor(index + 1, scheme) });
  });
  return moves;
}
