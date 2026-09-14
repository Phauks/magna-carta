import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { readEdgesForEntities, type DirectoryEdge } from "@magna-carta/directory/edges";
import { CORPORATE_EDGE_TYPES } from "./edge-classes.ts";
import type { EdgeStep } from "./types.ts";

export { CORPORATE_EDGE_TYPES };

// THE WALK FOLLOWS EVERY RECORDED RELATIONSHIP TO CLOSURE.
//
// It used to be budgeted: a hop allowance per edge class, a firm default, a per-run override and a
// closure cap a firm could set. The owner removed all of it on 2026-09-11
// (docs/conventions/conflicts-rulings.md, E1 and E2): a limit on how far a check follows
// relationships is a conflict the firm does not find, and that is the failure that matters. So the
// traversal is a plain breadth-first walk over the Directory's edges — every class, every hop,
// ended relationships included — and it stops only when there is nothing left to reach.
//
// THE ONE CEILING THAT SURVIVES IS THE PLATFORM'S, NOT THE FIRM'S. A walk over a real corpus can
// reach a clearing bank, a registered agent or a court, and from there every party those touch; a
// run that reached a hundred thousand entities would not finish inside the invocation it runs in
// and would hand the batched matcher a closure it cannot query in one budget. That is a fact about
// what one run can do, not a judgement about how far a firm should look, which is why it is a
// constant here rather than a setting anywhere, and why reaching it is recorded on the check row and
// stated in the report rather than applied quietly. The number is an order of magnitude past the
// widest closure the load profile has measured a real corporate group at, and well inside what the
// chunked subject-facts and matching reads can carry in one run.
export const WALK_CEILING = 10_000;

// An entity reached from a subject party, with the edges that connected it. The path is the hit's
// explanation: a reviewer must see WHY an entity surfaced, not merely that it did.
export interface ExpandedEntity {
  readonly entityId: string;
  readonly path: readonly EdgeStep[];
}

export interface ExpansionOptions {
  // The instant edge expiry is judged against — the check's own clock, never an ambient `new Date()`,
  // so two reads inside one check cannot disagree about whether a relationship had ended.
  readonly asOf: string;
  // The most entities this walk may reach, seeds included. Defaults to the platform ceiling; a
  // measurement harness may pass a smaller one to exercise the truncation path, and nothing a firm
  // can configure reaches this.
  readonly ceiling?: number;
  // Called after each round of the walk with how many entities have been reached so far, so a screen
  // watching a long walk has something true to say while it runs.
  readonly onRound?: (reached: number) => void | Promise<void>;
}

// WHAT THE WALK DID NOT SEE. Present only when the ceiling stopped the expansion, and then it is
// carried all the way onto the check row: a truncated expansion must never be read as a completed
// one, the same way a source that could not run must never be read as searched and clean. The two
// counts are kept apart because they are different facts:
//
//   unexploredFrontierSize  — distinct entities the walk discovered as neighbours and refused to
//                             admit. These were NOT matched. They are the search that did not happen.
//   unexpandedReachedCount  — entities that ARE in the closure and WERE matched, but whose own edges
//                             were never read, so whatever lies beyond them is unknown.
export interface ExpansionTruncation {
  readonly entitiesReached: number;
  readonly unexploredFrontierSize: number;
  readonly unexpandedReachedCount: number;
  readonly ceiling: number;
}

export interface ExpansionResult {
  readonly entities: readonly ExpandedEntity[];
  // Null when the walk ran to completion — every reachable entity was reached and expanded.
  readonly truncation: ExpansionTruncation | null;
  // The longest chain of relationships the walk followed to reach anything: a fact about the
  // corpus, recorded so a reader of the row can see how deep the closure actually ran.
  readonly longestPathLength: number;
}

// The path a reviewer is shown for an entity reached several ways: shortest, then the
// lexicographically first edge-id sequence. Every tie-break is on stored data, so the explanation
// for one corpus is the same on every run and on every machine.
function preferredPath(left: readonly EdgeStep[], right: readonly EdgeStep[]): readonly EdgeStep[] {
  if (left.length !== right.length) return left.length < right.length ? left : right;
  const leftKey = left.map((step) => step.edgeId).join("|");
  const rightKey = right.map((step) => step.edgeId).join("|");
  return leftKey <= rightKey ? left : right;
}

// DEGREE-BASED HUB SUPPRESSION IS REFUSED, and this is where the refusal lives because this is where
// the temptation is. Skipping any node carrying more than N edges is the obvious way to keep a
// closure small, and it is wrong: a clearing bank or a registered agent that appears on five hundred
// matters is precisely where a positional conflict lives, and a search that quietly stepped around it
// has narrowed itself without telling anyone. The bound belongs on the SIZE of the closure, where
// reaching it is a recordable fact, not on the SHAPE of the graph, where reaching it is invisible.
// A firm may mark an entity non-expandable — that is a recorded, attributable firm assertion, and it
// is a different thing from a platform heuristic.

export async function expandGraph(
  database: BatchDatabase,
  seedEntityIds: readonly string[],
  options: ExpansionOptions,
): Promise<ExpansionResult> {
  const ceiling = options.ceiling ?? WALK_CEILING;
  // Every entity reached, with the path it is shown under. Breadth-first, so the first path that
  // reaches an entity is a shortest one; a same-length path found later in the same round is kept
  // only if it sorts first, so the explanation is deterministic.
  const reached = new Map<string, readonly EdgeStep[]>();
  // Entities admitted in the last round and not yet expanded.
  let frontier: string[] = [];
  // Distinct entities the ceiling refused. These were never matched.
  const refused = new Set<string>();
  let truncated = false;
  let longestPathLength = 0;

  // Seeds bypass the ceiling. It bounds how far the walk EXPANDS, never which parties the caller
  // named as subjects — dropping a subject party would be a search that skipped the matter's own
  // client, which no bound may ever produce. Seeding past the ceiling therefore starts the walk
  // already over it, so the first expansion refuses everything and the run records itself truncated,
  // which is the honest report of exactly that situation.
  for (const seedEntityId of new Set(seedEntityIds)) {
    if (reached.has(seedEntityId)) continue;
    reached.set(seedEntityId, []);
    frontier.push(seedEntityId);
  }

  // Entities admitted whose own edges were never read, because the ceiling stopped the walk first.
  const unexpanded = new Set<string>();

  while (frontier.length > 0 && !truncated) {
    // Deterministic round order: the ceiling decides which entities make it in, so which entity is
    // considered first must not depend on the database's row order or on Promise scheduling.
    const round = [...frontier].sort((left, right) => left.localeCompare(right));
    frontier = [];

    const edgesByEntity = await readEdgesForEntities(database, round, {
      asOf: options.asOf,
      includeExpired: true,
    });

    for (const [index, entityId] of round.entries()) {
      if (truncated) {
        for (const remaining of round.slice(index)) unexpanded.add(remaining);
        break;
      }
      const path = reached.get(entityId) ?? [];
      const edges = [...(edgesByEntity.get(entityId) ?? [])].sort((left, right) =>
        left.id.localeCompare(right.id),
      );
      for (const edge of edges) {
        const neighbourId = edge.fromEntityId === entityId ? edge.toEntityId : edge.fromEntityId;
        if (neighbourId === entityId) continue;
        const nextPath = [...path, edgeStepFor(edge, options.asOf)];
        const existing = reached.get(neighbourId);
        if (existing !== undefined) {
          // Reached already, this round or an earlier one. Breadth-first order means an earlier round's
          // path is shorter; a same-round path may only replace it by sorting first.
          if (existing.length === nextPath.length) {
            reached.set(neighbourId, preferredPath(existing, nextPath));
          }
          continue;
        }
        if (reached.size >= ceiling) {
          truncated = true;
          refused.add(neighbourId);
          // This entity's remaining edges were never walked, so it is itself a boundary — the same
          // kind as the entries still queued behind it, and counted with them rather than dropped.
          unexpanded.add(entityId);
          break;
        }
        reached.set(neighbourId, nextPath);
        longestPathLength = Math.max(longestPathLength, nextPath.length);
        frontier.push(neighbourId);
      }
    }

    if (options.onRound !== undefined) await options.onRound(reached.size);
  }

  const entities = [...reached.entries()]
    .map(([entityId, path]) => ({ entityId, path }))
    .sort(
      (left, right) =>
        left.path.length - right.path.length || left.entityId.localeCompare(right.entityId),
    );

  if (!truncated) return { entities, truncation: null, longestPathLength };

  // Everything still queued when the walk stopped is in the closure and was matched, but its own
  // edges were never read — so it is a boundary too, and a different one from the refused set.
  for (const queued of frontier) unexpanded.add(queued);
  return {
    entities,
    truncation: {
      entitiesReached: entities.length,
      unexploredFrontierSize: refused.size,
      unexpandedReachedCount: unexpanded.size,
      ceiling,
    },
    longestPathLength,
  };
}

// Expired edges are traversed, and the expiry travels on the step. The professional-conduct rules are
// about FORMER clients and FORMER relationships — a divorced spouse, a subsidiary sold last year — so
// a traversal that stopped at currency would drop the dimension they care most about. What the
// platform does with it is report it: the reviewer sees that the connection had ended and weighs it.
function edgeStepFor(edge: DirectoryEdge, asOf: string): EdgeStep {
  return {
    edgeId: edge.id,
    edgeType: edge.edgeType,
    fromEntityId: edge.fromEntityId,
    toEntityId: edge.toEntityId,
    expiredAtCheck: edge.validTo !== null && edge.validTo <= asOf,
  };
}
