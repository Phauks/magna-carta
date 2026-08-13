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
        .map((entry) => `${displayNameForSource(entry.source)} (${entry.reason ?? "no reason recorded"})`)
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
