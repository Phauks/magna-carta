import { displayNameForSource } from "./sources.ts";
import type { EvidenceTier, SourceAvailability, Strictness } from "./types.ts";

// The reader-facing account of ONE check: what ran, with what settings, over how many entities; what
// did not run and why; and what surfaced.
//
// Every sentence this module can produce is a fact about the SEARCH, verifiable from the check's own
// recorded row — these channels executed, this source has no corpus, this many candidates surfaced.
// None of them is a fact about the matter. That boundary is the whole point of the module and it is
// why the zero-hit ending is "Nothing surfaced." rather than any sentence containing the word the
// reader is hoping for: a firm defending a disqualification motion has to defend the sentence its
// system produced, and "we searched the party corpus at over-inclusive strictness, traversed 43
// entities, could not search content because no corpus exists, and nothing surfaced" is a procedure.
// "No conflicts" (conflicts-vocabulary:allow — names the banned conclusion in order to refuse it) is a
// conclusion, and drawing it is a lawyer's act, not the platform's.
//
// Pure and synchronous: no database access, no clock, no locale. The caller supplies the facts.

export interface ReportedSource {
  // The stored scope key: a SourceClass, or a registered source with no class of its own.
  readonly source: string;
  readonly availability: SourceAvailability;
  // Why it could not run. Null when it ran.
  readonly reason: string | null;
}

// What the graph walk was allowed to do and whether it finished, as recorded on the check row.
export interface ReportedTraversal {
  readonly edgeClassBudgets: Readonly<Record<string, number>>;
  readonly closureCap: number | null;
  readonly truncated: boolean;
  readonly entitiesReached: number | null;
  readonly unexploredFrontierSize: number | null;
  readonly unexpandedReachedCount: number | null;
}

export interface ReportedCheck {
  readonly createdAt: string;
  readonly trigger: string;
  // Null when no acting member is on the row.
  readonly actorUserId: string | null;
  readonly strictness: Strictness;
  readonly depth: number;
  readonly floorRaised: boolean;
  readonly subjectEntityCount: number;
  // Subject parties plus everything the graph traversal reached from them. Equals the subject count
  // when the graph class did not run.
  readonly expandedEntityCount: number;
  // Identifier types the corpus cannot probe on their own, recorded so the log never implies they
  // were searched.
  readonly skippedIdentifierTypes: readonly string[];
  // Null on a check written before the traversal record existed, which the statement reports as the
  // row not saying rather than as the walk having completed.
  readonly traversal?: ReportedTraversal | null;
}

export interface ReportedHit {
  readonly evidenceTier: EvidenceTier;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

// The stored timestamp rendered for a reader, in UTC and said so. Deliberately not localized: the log
// is one record read by the firm, by opposing counsel, and by a court, and a sentence that says a
// different date depending on who opened it is a sentence nobody can cite. A timestamp that does not
// parse is passed through verbatim rather than replaced by a guess.
export function describeCheckInstant(createdAt: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T/.exec(createdAt);
  if (match === null) return createdAt;
  const monthName = MONTH_NAMES[Number(match[2]) - 1];
  if (monthName === undefined) return createdAt;
  return `${Number(match[3])} ${monthName} ${match[1]} (UTC)`;
}

function countByTier(hits: readonly ReportedHit[]): Map<EvidenceTier, number> {
  const counts = new Map<EvidenceTier, number>();
  for (const hit of hits) counts.set(hit.evidenceTier, (counts.get(hit.evidenceTier) ?? 0) + 1);
  return counts;
}

function searched(sources: readonly ReportedSource[], source: string): boolean {
  return sources.some((entry) => entry.source === source && entry.availability === "searched");
}

// The traversal's own account of itself: what it was allowed to walk, and — the sentence that
// matters — whether it finished.
//
// A truncated expansion is NEVER reported as a completed one. It is the depth version of the rule
// that a source with no corpus records `unavailable` and never reads as having been searched: in
// both cases the platform looked at part of the world and has to say which part, because a firm
// defending its procedure can defend "we searched 500 related entities and 137 more were reachable
// and not searched" and cannot defend a number that quietly stopped meaning what it says.
function describeTraversal(traversal: ReportedTraversal | null): string[] {
  if (traversal === null) return [];
  const statements: string[] = [];

  const budgets = Object.entries(traversal.edgeClassBudgets).toSorted(([left], [right]) =>
    left.localeCompare(right),
  );
  if (budgets.length > 0) {
    statements.push(
      `Traversal budgets — ${budgets
        .map(([edgeClass, budget]) => `${edgeClass} ${budget} hop${budget === 1 ? "" : "s"}`)
        .join(
          ", ",
        )}; corporate family traversed transitively. Ended relationships were traversed ` +
        `and each is marked on the path that reached through it.`,
    );
  }

  if (!traversal.truncated) return statements;

  const reached = traversal.entitiesReached;
  const cap = traversal.closureCap;
  const frontier = traversal.unexploredFrontierSize;
  const unexpanded = traversal.unexpandedReachedCount;
  const parts: string[] = [];
  if (reached !== null && cap !== null) {
    parts.push(`${reached} entities reached against a cap of ${cap}`);
  } else if (cap !== null) {
    parts.push(`the cap of ${cap} entities was reached`);
  }
  if (frontier !== null) {
    parts.push(
      `${frontier} further ${frontier === 1 ? "entity was" : "entities were"} reachable and not searched`,
    );
  }
  if (unexpanded !== null && unexpanded > 0) {
    parts.push(
      `${unexpanded} reached ${unexpanded === 1 ? "entity was" : "entities were"} matched but not expanded, so what lies beyond ${unexpanded === 1 ? "it" : "them"} is unknown`,
    );
  }
  statements.push(
    `Graph — THE TRAVERSAL WAS TRUNCATED and this search of the graph is incomplete: ${parts.join("; ")}.`,
  );
  return statements;
}

// The full statement list for one check, in reading order. Each entry is one sentence or clause a
// caller renders as its own line; the module does not join them, because the caller owns the medium.
export function describeCheck(
  check: ReportedCheck,
  hits: readonly ReportedHit[],
  sources: readonly ReportedSource[],
): readonly string[] {
  const statements: string[] = [];

  const actor =
    check.actorUserId === null ? "with no acting member recorded" : `by ${check.actorUserId}`;
  statements.push(
    `Searched on ${describeCheckInstant(check.createdAt)} ${actor}, trigger ${check.trigger}.`,
  );

  if (check.floorRaised) {
    statements.push(
      "The requested scope fell below the firm's floor and was raised to it before the search ran.",
    );
  }

  if (searched(sources, "party")) {
    statements.push(
      `Party — name and identifier similarity at ${check.strictness} strictness, over ` +
        `${check.subjectEntityCount} subject ${check.subjectEntityCount === 1 ? "party" : "parties"}.`,
    );
  }

  if (searched(sources, "graph")) {
    statements.push(
      check.depth === 0
        ? `Graph — traversal budget 0, so no related entity was reached beyond the ${check.subjectEntityCount} subject parties themselves.`
        : `Graph — ${check.expandedEntityCount} entities reached from the subject parties, at a ${check.depth}-hop traversal budget.`,
    );
    statements.push(...describeTraversal(check.traversal ?? null));
  }

  if (searched(sources, "imputation")) {
    statements.push(
      "Imputation — identity join between the matter's parties and the firm's own members. Never a name match.",
    );
  }

  if (check.skippedIdentifierTypes.length > 0) {
    statements.push(
      `Not probed as standalone identifiers (the corpus cannot index them on their own): ` +
        `${check.skippedIdentifierTypes.join(", ")}.`,
    );
  }

  const unavailable = sources.filter((entry) => entry.availability === "unavailable");
  if (unavailable.length > 0) {
    statements.push(
      `Not searched: ${unavailable
        .map(
          (entry) =>
            `${displayNameForSource(entry.source)} (${entry.reason ?? "no reason recorded"})`,
        )
        .join(", ")}.`,
    );
  }

  if (hits.length === 0) {
    // The only conclusion the platform draws, and it is a statement about the search ending rather
    // than about the matter. Nothing here may grow into a clearance.
    statements.push("Nothing surfaced.");
    return statements;
  }

  const byTier = [...countByTier(hits)]
    .toSorted(([left], [right]) => left - right)
    .map(([tier, count]) => `tier ${tier}: ${count}`)
    .join(", ");
  statements.push(
    `${hits.length} ${hits.length === 1 ? "candidate" : "candidates"} surfaced for review (${byTier}).`,
  );
  return statements;
}
