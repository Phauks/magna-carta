import { displayNameForSource } from "./sources.ts";
import type { EvidenceTier, SourceAvailability, Strictness } from "./types.ts";

// The reader-facing account of ONE check: what ran, with what settings, over how many entities; what
// did not run and why; and what surfaced.
//
// Every sentence this module can produce is a fact about the SEARCH, verifiable from the check's own
// recorded row — these channels executed, this source has no corpus, this many candidates surfaced.
// None of them is a fact about the matter. That boundary is the whole point of the module and it is
// why the zero-hit ending is "0 results." rather than any sentence containing the word the
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

// What the graph walk did and whether it finished, as recorded on the check row.
export interface ReportedTraversal {
  // True on a run that followed every relationship to closure; false on a row written under the
  // old hop budgets, which then say how far it went.
  readonly followedToClosure: boolean;
  readonly longestPathLength: number | null;
  readonly edgeClassBudgets: Readonly<Record<string, number>>;
  // The most entities the walk could reach: the platform's ceiling, or an older row's firm cap.
  readonly closureCap: number | null;
  readonly truncated: boolean;
  readonly entitiesReached: number | null;
  readonly unexploredFrontierSize: number | null;
  readonly unexpandedReachedCount: number | null;
}

// How many candidates the run was allowed to write and whether it had to refuse any, as recorded on
// the check row.
export interface ReportedCandidates {
  readonly candidateCap: number | null;
  readonly truncated: boolean;
  readonly candidatesSurfaced: number | null;
  readonly candidatesWritten: number | null;
  readonly candidatesRefused: number | null;
  readonly refusedByTier: ReadonlyArray<{ readonly tier: EvidenceTier; readonly count: number }>;
}

export interface ReportedCheck {
  readonly createdAt: string;
  readonly trigger: string;
  // Null when no acting member is on the row.
  readonly actorUserId: string | null;
  // The acting member's name as the firm's roster gives it. The statement is read by people, so it
  // names the member rather than quoting their handle; null where the roster has no name for them.
  readonly actorDisplayName?: string | null;
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
  // Null on a check written before the candidate record existed, and treated the same way.
  readonly candidates?: ReportedCandidates | null;
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

// The traversal's own account of itself: how it walked, and — the sentence that matters — whether
// it finished.
//
// A truncated expansion is NEVER reported as a completed one. It is the depth version of the rule
// that a source with no corpus records `unavailable` and never reads as having been searched: in
// both cases the platform looked at part of the world and has to say which part, because a firm
// defending its procedure can defend "we searched 10,000 related entities and 137 more were
// reachable and not searched" and cannot defend a number that quietly stopped meaning what it says.
function describeTraversal(traversal: ReportedTraversal | null): string[] {
  if (traversal === null) return [];
  const statements: string[] = [];

  if (traversal.followedToClosure) {
    statements.push(
      "Traversal — every recorded relationship was followed to closure, whatever its kind and " +
        "however long the chain. Ended relationships were traversed and each is marked on the path " +
        "that reached through it.",
    );
  } else {
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
  }

  if (!traversal.truncated) return statements;

  const reached = traversal.entitiesReached;
  const cap = traversal.closureCap;
  const boundWord = traversal.followedToClosure ? "the platform's ceiling" : "a cap";
  const frontier = traversal.unexploredFrontierSize;
  const unexpanded = traversal.unexpandedReachedCount;
  const parts: string[] = [];
  if (reached !== null && cap !== null) {
    parts.push(`${reached} entities reached against ${boundWord} of ${cap}`);
  } else if (cap !== null) {
    parts.push(`${boundWord} of ${cap} entities was reached`);
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

// The candidate bound's own account of itself, and — the sentence that matters — whether it bit.
//
// A run that refused candidates has searched less than the reader would otherwise assume from the hit
// count in front of them, so the count is stated against what the channels actually surfaced. The
// per-tier breakdown is spelled out rather than summarized: a run that refused only trigram-overlap
// candidates and a run that refused an exact-identifier match are not the same event, and a single
// number would render them identically.
function describeCandidateBound(candidates: ReportedCandidates | null): string[] {
  if (candidates === null || !candidates.truncated) return [];

  const surfaced = candidates.candidatesSurfaced;
  const written = candidates.candidatesWritten;
  const refused = candidates.candidatesRefused;
  const cap = candidates.candidateCap;
  const parts: string[] = [];
  if (surfaced !== null && written !== null) {
    parts.push(`${surfaced} candidates surfaced and ${written} were recorded`);
  }
  if (cap !== null) parts.push(`the bound in force was ${cap}, the most one record can carry`);
  if (refused !== null) {
    const byTier = candidates.refusedByTier
      .map((entry) => `tier ${entry.tier}: ${entry.count}`)
      .join(", ");
    parts.push(
      byTier.length === 0
        ? `${refused} ${refused === 1 ? "candidate was" : "candidates were"} refused`
        : `${refused} ${refused === 1 ? "candidate was" : "candidates were"} refused (${byTier})`,
    );
  }
  return [
    `Candidates — THE CANDIDATE SET WAS TRUNCATED and this search is incomplete: ${parts.join("; ")}. ` +
      `The strongest evidence was kept; a co-party surfacing is never refused.`,
  ];
}

// The full statement list for one check, in reading order. Each entry is one sentence or clause a
// caller renders as its own line; the module does not join them, because the caller owns the medium.
export function describeCheck(
  check: ReportedCheck,
  hits: readonly ReportedHit[],
  sources: readonly ReportedSource[],
): readonly string[] {
  const statements: string[] = [];

  // A handle is never printed: a member the roster cannot name is said to be one, not quoted.
  const name = check.actorDisplayName?.trim() ?? "";
  const actor =
    check.actorUserId === null
      ? "with no acting member recorded"
      : name.length > 0
        ? `by ${name}`
        : "by a member the firm's roster does not name";
  statements.push(
    `Searched on ${describeCheckInstant(check.createdAt)} ${actor}, as a ${check.trigger} check.`,
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
    const traversal = check.traversal ?? null;
    if (traversal?.followedToClosure === true) {
      const deepest =
        traversal.longestPathLength === null
          ? ""
          : traversal.longestPathLength === 0
            ? "; no recorded relationship led away from them"
            : `; the longest chain followed ran ${traversal.longestPathLength} ${traversal.longestPathLength === 1 ? "relationship" : "relationships"}`;
      statements.push(
        `Graph — ${check.expandedEntityCount} entities reached from the subject parties${deepest}.`,
      );
    } else {
      statements.push(
        check.depth === 0
          ? `Graph — traversal budget 0, so no related entity was reached beyond the ${check.subjectEntityCount} subject parties themselves.`
          : `Graph — ${check.expandedEntityCount} entities reached from the subject parties, at a ${check.depth}-hop traversal budget.`,
      );
    }
    statements.push(...describeTraversal(traversal));
  }

  if (searched(sources, "imputation")) {
    statements.push(
      "Firm employees — identity join between the firm's own members and the matter's parties, or every entity reached where no matter is named. Never a name match.",
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

  const candidates = check.candidates ?? null;
  statements.push(...describeCandidateBound(candidates));

  if (hits.length === 0) {
    // "0 results." is a fact about the machine's own behaviour, and it is only a fact when the
    // machine wrote everything it found. A run whose cap refused every candidate found plenty and
    // recorded none, so the truncation sentence above is the whole and only account of it — appending
    // this one would state the exact opposite of what happened.
    if (candidates === null || !candidates.truncated) {
      // The only conclusion the platform draws, and it is a statement about the search ending rather
      // than about the matter. Nothing here may grow into a clearance.
      statements.push("0 results.");
    }
    return statements;
  }

  const byTier = [...countByTier(hits)]
    .toSorted(([left], [right]) => left - right)
    .map(([tier, count]) => `tier ${tier}: ${count}`)
    .join(", ");
  // "Surfaced" and "recorded" are the same number on an unbounded run and are NOT on a bounded one, so
  // the closing sentence changes verb rather than letting the reader take a written count for
  // everything the channels found. The truncation statement above carries the surfaced figure.
  const verb = candidates !== null && candidates.truncated ? "recorded" : "surfaced";
  statements.push(
    `${hits.length} ${hits.length === 1 ? "result" : "results"} ${verb} for review (${byTier}).`,
  );
  return statements;
}
