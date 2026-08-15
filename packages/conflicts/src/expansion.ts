import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { readEdgesForEntities, type DirectoryEdge } from "@magna-carta/directory/edges";
import {
  BUDGETED_EDGE_CLASSES,
  CORPORATE_EDGE_TYPES,
  edgeClassOf,
  type BudgetedEdgeClass,
} from "./edge-classes.ts";
import type { EdgeClassBudgets } from "./settings.ts";
import type { EdgeStep } from "./types.ts";

export { CORPORATE_EDGE_TYPES };

// An entity reached from a subject party, with the edges that connected it. The path is the hit's
// explanation: a reviewer must see WHY an entity surfaced, not merely that it did.
export interface ExpandedEntity {
  readonly entityId: string;
  readonly path: readonly EdgeStep[];
}

export interface ExpansionBudget {
  readonly edgeClassBudgets: EdgeClassBudgets;
  // The most entities this run may expand to, counting the seeds.
  readonly closureCap: number;
  // The instant edge expiry is judged against — the check's own clock, never an ambient `new Date()`,
  // so two reads inside one check cannot disagree about whether a relationship had ended.
  readonly asOf: string;
}

// WHAT THE WALK DID NOT SEE. Present only when the closure cap stopped the expansion, and then it is
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
  readonly closureCap: number;
  readonly edgeClassBudgets: EdgeClassBudgets;
}

export interface ExpansionResult {
  readonly entities: readonly ExpandedEntity[];
  // Null when the walk ran to completion — every reachable entity within the class budgets was
  // reached and expanded.
  readonly truncation: ExpansionTruncation | null;
}

// The per-class hop counts consumed by one path. Corporate hops are absent by construction: they cost
// nothing and are bounded only by the closure cap.
type HopVector = Readonly<Record<BudgetedEdgeClass, number>>;

const ZERO_HOPS: HopVector = Object.freeze(
  Object.fromEntries(BUDGETED_EDGE_CLASSES.map((edgeClass) => [edgeClass, 0])),
) as unknown as HopVector;

interface Reached {
  readonly hops: HopVector;
  readonly path: readonly EdgeStep[];
}

function totalHops(hops: HopVector): number {
  let total = 0;
  for (const edgeClass of BUDGETED_EDGE_CLASSES) total += hops[edgeClass];
  return total;
}

// `left` costs no more than `right` in every class, so anything reachable from `right` is reachable
// from `left`. Pareto dominance is what replaces the shipped single-integer relaxation: with one
// budget per class there is no total order on cost, and collapsing the vector to its sum would let a
// path that spent its whole family budget look cheaper than one that spent two control hops and could
// still walk a family edge. That collapse drops real conflicts, silently.
function dominates(left: HopVector, right: HopVector): boolean {
  for (const edgeClass of BUDGETED_EDGE_CLASSES) {
    if (left[edgeClass] > right[edgeClass]) return false;
  }
  return true;
}

// The path a reviewer is shown for an entity reached several ways: cheapest overall, then shortest,
// then the lexicographically first edge-id sequence. Every tie-break is on stored data, so the
// explanation for one corpus is the same on every run and on every machine.
function preferredPath(left: Reached, right: Reached): Reached {
  const leftTotal = totalHops(left.hops);
  const rightTotal = totalHops(right.hops);
  if (leftTotal !== rightTotal) return leftTotal < rightTotal ? left : right;
  if (left.path.length !== right.path.length) {
    return left.path.length < right.path.length ? left : right;
  }
  const leftKey = left.path.map((step) => step.edgeId).join("|");
  const rightKey = right.path.map((step) => step.edgeId).join("|");
  return leftKey <= rightKey ? left : right;
}

// An edge type this build has never heard of takes the WIDEST budget in force rather than the
// narrowest. `directory_edge.edge_type` carries only a `length > 0` CHECK, so a value can outlive the
// catalogue that named it, and a new relationship type that quietly became unwalkable would be a
// conflict the engine stopped looking for without anybody choosing that.
function budgetForEdgeType(edgeType: string, budgets: EdgeClassBudgets): BudgetedEdgeClass | null {
  const edgeClass = edgeClassOf(edgeType);
  if (edgeClass === "corporate") return null;
  if (edgeClass !== null) return edgeClass;
  let widest: BudgetedEdgeClass = BUDGETED_EDGE_CLASSES[0];
  for (const candidate of BUDGETED_EDGE_CLASSES) {
    if (budgets[candidate] > budgets[widest]) widest = candidate;
  }
  return widest;
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
  budget: ExpansionBudget,
): Promise<ExpansionResult> {
  // For each entity, the Pareto-minimal set of hop vectors it has been reached by. A vector is kept
  // only while nothing already recorded dominates it, and adding one evicts everything it dominates.
  const reached = new Map<string, Reached[]>();
  // States admitted but not yet expanded — a whole round is read from the database at once, so the
  // query count follows the shape of the walk rather than the size of the corpus.
  let frontier: Array<{ entityId: string; state: Reached }> = [];
  // Distinct entities the cap refused. These were never matched.
  const refused = new Set<string>();
  let truncated = false;

  const admit = (entityId: string, state: Reached): boolean => {
    const existing = reached.get(entityId);
    if (existing === undefined) {
      if (reached.size >= budget.closureCap) {
        truncated = true;
        refused.add(entityId);
        return false;
      }
      reached.set(entityId, [state]);
      return true;
    }
    if (existing.some((entry) => dominates(entry.hops, state.hops))) return false;
    const kept = existing.filter((entry) => !dominates(state.hops, entry.hops));
    kept.push(state);
    reached.set(entityId, kept);
    return true;
  };

  // Seeds bypass the cap. The cap bounds how far the walk EXPANDS, never which parties the caller
  // named as subjects — dropping a subject party would be a search that skipped the matter's own
  // client, which no bound may ever produce. Seeding past the cap therefore starts the walk already
  // over it, so the first expansion refuses everything and the run records itself truncated, which is
  // the honest report of exactly that situation.
  for (const seedEntityId of new Set(seedEntityIds)) {
    const state: Reached = { hops: ZERO_HOPS, path: [] };
    if (reached.has(seedEntityId)) continue;
    reached.set(seedEntityId, [state]);
    frontier.push({ entityId: seedEntityId, state });
  }

  // Admitted states whose own edges were never read, because the cap stopped the walk first.
  const unexpanded: Array<{ entityId: string; state: Reached }> = [];

  while (frontier.length > 0 && !truncated) {
    // Deterministic round order: the cap decides which entities make it in, so which entity is
    // considered first must not depend on the database's row order or on Promise scheduling.
    const round = [...frontier].sort(
      (left, right) =>
        left.entityId.localeCompare(right.entityId) ||
        left.state.path.length - right.state.path.length,
    );
    frontier = [];

    const edgesByEntity = await readEdgesForEntities(
      database,
      round.map((entry) => entry.entityId),
      { asOf: budget.asOf, includeExpired: true },
    );

    for (const [index, entry] of round.entries()) {
      if (truncated) {
        unexpanded.push(...round.slice(index));
        break;
      }
      const { entityId, state } = entry;
      // A cheaper vector found later in the walk may have evicted this one; expanding a superseded
      // state would record a path a reviewer would have to explain away.
      const current = reached.get(entityId);
      if (current === undefined || !current.includes(state)) continue;

      const edges = [...(edgesByEntity.get(entityId) ?? [])].sort((left, right) =>
        left.id.localeCompare(right.id),
      );
      for (const edge of edges) {
        const spentClass = budgetForEdgeType(edge.edgeType, budget.edgeClassBudgets);
        let nextHops = state.hops;
        if (spentClass !== null) {
          if (state.hops[spentClass] >= budget.edgeClassBudgets[spentClass]) continue;
          nextHops = { ...state.hops, [spentClass]: state.hops[spentClass] + 1 };
        }

        const neighbourId = edge.fromEntityId === entityId ? edge.toEntityId : edge.fromEntityId;
        if (neighbourId === entityId) continue;
        const nextState: Reached = {
          hops: nextHops,
          path: [...state.path, edgeStepFor(edge, budget.asOf)],
        };
        if (admit(neighbourId, nextState)) {
          frontier.push({ entityId: neighbourId, state: nextState });
        }
        if (truncated) {
          // This entity's remaining edges were never walked, so it is itself a boundary — the same
          // kind as the entries still queued behind it, and counted with them rather than dropped.
          unexpanded.push(entry);
          break;
        }
      }
    }
  }

  const entities = [...reached.entries()]
    .map(([entityId, states]) => ({ entityId, path: states.reduce(preferredPath).path }))
    .sort(
      (left, right) =>
        left.path.length - right.path.length || left.entityId.localeCompare(right.entityId),
    );

  if (!truncated) return { entities, truncation: null };

  // Everything still queued when the walk stopped is in the closure and was matched, but its own
  // edges were never read — so it is a boundary too, and a different one from the refused set.
  const unexpandedEntityIds = new Set([...unexpanded, ...frontier].map((entry) => entry.entityId));
  return {
    entities,
    truncation: {
      entitiesReached: entities.length,
      unexploredFrontierSize: refused.size,
      unexpandedReachedCount: unexpandedEntityIds.size,
      closureCap: budget.closureCap,
      edgeClassBudgets: budget.edgeClassBudgets,
    },
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
