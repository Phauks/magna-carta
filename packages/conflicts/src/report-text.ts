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

// What a run searched beyond the Directory, as recorded on the check row (run-check.ts, `places`).
export interface ReportedPlaces {
  readonly messaging: readonly string[];
  readonly tasks: readonly string[];
  readonly magnus: boolean;
  // Absent on rows written before Files could be searched.
  readonly files?: readonly string[];
  // Whether the file contents index answered; null when the row does not say.
  readonly filesSearched?: boolean | null;
  readonly fileMattersInReach?: number | null;
  readonly fileMattersSearched?: number | null;
  readonly fileMattersNotSearched?: number | null;
  readonly fileMattersFailed?: number | null;
  readonly nameFloor: number | null;
  // How many names reached the most records one name keeps from one place, and that ceiling. Absent
  // on rows written before the record index was read.
  readonly namesAtCeiling?: number | null;
  readonly nameResultCeiling?: number | null;
  readonly resultsFound: number | null;
  readonly resultsRefused: number | null;
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
  // False when a person turned trigram matching off for the check. Absent reads as on.
  readonly trigramMatching?: boolean;
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
  // Null when the run searched none of the firm's own records.
  readonly places?: ReportedPlaces | null;
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

// ONE SECTION OF THE ACCOUNT. A screen draws each as a block under its heading and a printed report
// as a section of its own, so the account reads as parts rather than as one numbered paragraph. The
// key says which part it is, so a screen can file the places' sections under the places and the rest
// under the Directory without parsing a sentence. `attention` marks a section that says the search
// was narrower than asked or stopped short: what was not searched, a walk or a candidate set that hit
// its bound. It is a fact about the search, never a judgement about the matter.
export const REPORT_SECTION_KEYS = [
  "searched",
  "names",
  "relationships",
  "employees",
  "messaging",
  "tasks",
  "magnus",
  "files",
  "not_searched",
  "results",
] as const;
export type ReportSectionKey = (typeof REPORT_SECTION_KEYS)[number];

export interface ReportSection {
  readonly key: ReportSectionKey;
  readonly heading: string;
  readonly lines: readonly string[];
  readonly attention: boolean;
}

// The two name-matching bands as a reader knows them. The same words the New Check panel shows
// (apps/web/src/lib/conflicts/conflicts-vocabulary.ts), because the account is read beside it.
const BAND_WORDS: Readonly<Record<Strictness, string>> = {
  balanced: "Standard",
  over_inclusive: "Widest",
};

// Identifier types a check records as not looked up on their own, in a reader's words.
const IDENTIFIER_WORDS: Readonly<Record<string, string>> = {
  dob: "Date of birth",
  ssn_last_four: "Last four of SSN",
};

function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function capitalized(text: string): string {
  return text.length === 0 ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

// The walk's own account of itself: how it walked and, the sentence that matters, whether it
// finished.
//
// A truncated expansion is NEVER reported as a completed one. It is the depth version of the rule
// that a source with no corpus records `unavailable` and never reads as having been searched: in
// both cases the platform looked at part of the world and has to say which part, because a firm
// defending its procedure can defend "we searched 10,000 related entities and 137 more were
// reachable and not searched" and cannot defend a number that quietly stopped meaning what it says.
function describeTraversal(traversal: ReportedTraversal | null): {
  readonly lines: string[];
  readonly truncated: boolean;
} {
  if (traversal === null) return { lines: [], truncated: false };
  const lines: string[] = [];

  if (traversal.followedToClosure) {
    lines.push(
      "Every relationship is followed to the end of its chain, whatever its kind. Ended relationships are followed too, and marked on the path that went through them.",
    );
  } else {
    const budgets = Object.entries(traversal.edgeClassBudgets).toSorted(([left], [right]) =>
      left.localeCompare(right),
    );
    if (budgets.length > 0) {
      lines.push(
        `Steps allowed for each kind of relationship: ${budgets
          .map(([edgeClass, budget]) => `${edgeClass} ${counted(budget, "step", "steps")}`)
          .join(
            ", ",
          )}. Corporate families were followed all the way. Ended relationships are followed too, and marked on the path that went through them.`,
      );
    }
  }

  if (!traversal.truncated) return { lines, truncated: false };

  const reached = traversal.entitiesReached;
  const cap = traversal.closureCap;
  const boundWord = traversal.followedToClosure ? "the platform's ceiling" : "a cap";
  const frontier = traversal.unexploredFrontierSize;
  const unexpanded = traversal.unexpandedReachedCount;
  const parts: string[] = [];
  if (reached !== null && cap !== null) {
    parts.push(
      `It reached ${counted(reached, "entity", "entities")}, against ${boundWord} of ${cap}.`,
    );
  } else if (cap !== null) {
    parts.push(`It reached ${boundWord} of ${cap} entities.`);
  }
  if (frontier !== null) {
    parts.push(
      `${counted(frontier, "further entity was", "further entities were")} reachable and not searched.`,
    );
  }
  if (unexpanded !== null && unexpanded > 0) {
    parts.push(
      `${counted(unexpanded, "entity was", "entities were")} matched but not followed further, so what lies beyond ${unexpanded === 1 ? "it" : "them"} is unknown.`,
    );
  }
  lines.push(
    [
      "The search of relationships is incomplete. The walk stopped before it finished.",
      ...parts,
    ].join(" "),
  );
  return { lines, truncated: true };
}

// The candidate bound's own account of itself and, the sentence that matters, whether it bit.
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
  const parts: string[] = ["The results are incomplete."];
  if (surfaced !== null && written !== null) {
    parts.push(
      `${counted(surfaced, "candidate was", "candidates were")} found and ${written} recorded.`,
    );
  }
  if (cap !== null) parts.push(`The most one record can carry is ${cap}.`);
  if (refused !== null) {
    const byTier = candidates.refusedByTier
      .map((entry) => `tier ${entry.tier}: ${entry.count}`)
      .join(", ");
    parts.push(
      byTier.length === 0
        ? `${counted(refused, "candidate was", "candidates were")} not recorded.`
        : `${counted(refused, "candidate was", "candidates were")} not recorded (${byTier}).`,
    );
  }
  parts.push("The strongest evidence was kept, and a co-party is never left out.");
  return [parts.join(" ")];
}

function listed(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;
}

const MESSAGING_WORDS: Readonly<Record<string, string>> = {
  calls: "calls",
  texts: "texts",
  email: "email",
};

const TASK_STATUS_WORDS: Readonly<Record<string, string>> = {
  consultations: "consultations",
  open: "open matters",
  closed: "closed matters",
};

function section(
  key: ReportSectionKey,
  heading: string,
  lines: readonly string[],
  attention = false,
): ReportSection {
  return { key, heading, lines, attention };
}

// One section per place beyond the Directory. Every one says how the parties were looked for,
// because "searched" over prose means something narrower than it does over the Directory, and the
// narrower reading is the true one.
function describePlaces(places: ReportedPlaces | null, partyCount: number): ReportSection[] {
  if (places === null) return [];
  const sections: ReportSection[] = [];
  const parties = counted(partyCount, "party", "parties");
  const byName =
    places.nameFloor === null
      ? "whole name"
      : `whole name (names of ${places.nameFloor} or more characters)`;
  if (places.messaging.length > 0) {
    const channels = listed(places.messaging.map((channel) => MESSAGING_WORDS[channel] ?? channel));
    const lines = [
      `${capitalized(channels)}, filed on a matter or not, searched for ${parties} by linked record, phone number, email address and ${byName}.`,
    ];
    if (places.messaging.includes("email")) {
      lines.push("Email is searched by its senders, recipients and subject. Its body is not.");
    }
    sections.push(section("messaging", "Messaging", lines));
  }
  if (places.tasks.length > 0) {
    const statuses = places.tasks.filter((status) => status !== "archived");
    const onMatters =
      statuses.length === 0
        ? "tasks on no matter"
        : `tasks on ${listed(statuses.map((status) => TASK_STATUS_WORDS[status] ?? status))}, and tasks on no matter`;
    const archived = places.tasks.includes("archived") ? ", plus archived tasks" : "";
    sections.push(
      section("tasks", "Tasks", [
        `Titles and descriptions of ${onMatters}${archived}, searched for ${parties} by ${byName}.`,
      ]),
    );
  }
  if (places.magnus) {
    sections.push(
      section("magnus", "Magnus", [
        `Every conversation, including those saved to General, searched for ${parties} by ${byName}.`,
      ]),
    );
  }
  const files = places.files ?? [];
  if (files.length > 0 && places.filesSearched === true) {
    const statuses = files.filter((status) => status !== "archived");
    const onMatters =
      statuses.length === 0
        ? "files deleted from any matter"
        : `files on ${listed(statuses.map((status) => TASK_STATUS_WORDS[status] ?? status))}${files.includes("archived") ? ", plus files deleted from any matter" : ""}`;
    const searchedCount = places.fileMattersSearched ?? null;
    const reach = places.fileMattersInReach ?? null;
    const across =
      searchedCount === null || reach === null
        ? ""
        : ` across ${searchedCount} of ${counted(reach, "matter", "matters")}`;
    const lines = [
      `The text of ${onMatters}${across}, searched for ${parties} by each name as an exact phrase.`,
    ];
    const notSearched = places.fileMattersNotSearched ?? 0;
    if (notSearched > 0) {
      lines.push(
        `${counted(notSearched, "matter's files were", "matters' files were")} not searched. The run reached the most questions one check asks the file index, and the most recently active matters were searched first.`,
      );
    }
    const failed = places.fileMattersFailed ?? 0;
    if (failed > 0) {
      lines.push(
        `${counted(failed, "matter's files", "matters' files")} could not be searched, because the file index did not answer for ${failed === 1 ? "it" : "them"}.`,
      );
    }
    sections.push(section("files", "Files", lines, notSearched > 0 || failed > 0));
  }
  return sections;
}

// What limited the places beyond the Directory, said beside the results it limited.
function describePlaceLimits(places: ReportedPlaces | null): string[] {
  if (places === null) return [];
  const lines: string[] = [];
  const atCeiling = places.namesAtCeiling ?? 0;
  if (atCeiling > 0) {
    const ceiling = places.nameResultCeiling ?? null;
    const most =
      ceiling === null ? "the most records a check keeps" : `the first ${ceiling} records`;
    lines.push(
      `${counted(atCeiling, "name was", "names were")} found in more records of one place than a check keeps. Only ${most} for ${atCeiling === 1 ? "it" : "each"} were recorded.`,
    );
  }
  if (places.resultsRefused !== null && places.resultsRefused > 0) {
    lines.push(
      `${counted(places.resultsRefused, "result", "results")} from messages, tasks, conversations or files ${places.resultsRefused === 1 ? "was" : "were"} not recorded, because the run reached the most one record can hold.`,
    );
  }
  return lines;
}

// The account of one check, as sections in reading order: who searched and when, what each part of
// the Directory search did, each place beyond it, what was not searched and why, and what surfaced.
// The module does not render them: the caller owns the medium.
export function describeCheck(
  check: ReportedCheck,
  hits: readonly ReportedHit[],
  sources: readonly ReportedSource[],
): readonly ReportSection[] {
  const sections: ReportSection[] = [];

  // A handle is never printed: a member the roster cannot name is said to be one, not quoted.
  const name = check.actorDisplayName?.trim() ?? "";
  const actor =
    check.actorUserId === null
      ? "with no acting member recorded"
      : name.length > 0
        ? `by ${name}`
        : "by a member the firm's roster does not name";
  const searchedLines = [
    `${describeCheckInstant(check.createdAt)} ${actor}, as a ${check.trigger} check.`,
  ];
  if (check.floorRaised) {
    searchedLines.push(
      "The search asked for was narrower than the firm's minimum, so it was widened to the minimum before it ran.",
    );
  }
  sections.push(section("searched", "Searched", searchedLines));

  const subjects = check.subjectEntityCount;
  if (searched(sources, "party")) {
    const lines = [
      `${subjects === 1 ? "1 party's" : `${subjects} parties'`} names and identifiers compared under ${BAND_WORDS[check.strictness]} name matching.`,
    ];
    if (check.trigramMatching === false) {
      lines.push(
        "Trigram matching was off, so names that share only a few letters with a party's were not looked for.",
      );
    }
    sections.push(section("names", "Names and identifiers", lines));
  }

  if (searched(sources, "graph")) {
    const traversal = check.traversal ?? null;
    const lines: string[] = [];
    if (traversal?.followedToClosure === true) {
      const reached = `${counted(check.expandedEntityCount, "entity", "entities")} reached from the parties.`;
      const deepest =
        traversal.longestPathLength === null
          ? ""
          : traversal.longestPathLength === 0
            ? " No recorded relationship led away from them."
            : ` The longest chain followed was ${counted(traversal.longestPathLength, "relationship", "relationships")}.`;
      lines.push(`${reached}${deepest}`);
    } else {
      lines.push(
        check.depth === 0
          ? `No relationship was followed, so only the ${counted(subjects, "party", "parties")} ${subjects === 1 ? "itself was" : "themselves were"} searched.`
          : `${counted(check.expandedEntityCount, "entity", "entities")} reached from the parties, following relationships up to ${counted(check.depth, "step", "steps")}.`,
      );
    }
    const walk = describeTraversal(traversal);
    lines.push(...walk.lines);
    sections.push(section("relationships", "Relationships", lines, walk.truncated));
  }

  if (searched(sources, "imputation")) {
    sections.push(
      section("employees", "Firm Employees", [
        "The firm's members compared with the matter's parties, or with every entity reached when no matter is named. By identity only, never by name.",
      ]),
    );
  }

  sections.push(...describePlaces(check.places ?? null, subjects));

  const notSearched: string[] = sources
    .filter((entry) => entry.availability === "unavailable")
    .map(
      (entry) =>
        `${capitalized(displayNameForSource(entry.source))}. ${capitalized(entry.reason ?? "No reason was recorded.")}`,
    );
  if (check.skippedIdentifierTypes.length > 0) {
    const kinds = check.skippedIdentifierTypes.map((type) => IDENTIFIER_WORDS[type] ?? type);
    notSearched.push(
      `${listed(kinds)}. ${kinds.length === 1 ? "It is" : "These are"} only compared beside a name, never looked up on ${kinds.length === 1 ? "its" : "their"} own.`,
    );
  }
  if (notSearched.length > 0) {
    sections.push(section("not_searched", "Not searched", notSearched, true));
  }

  const candidates = check.candidates ?? null;
  const results: string[] = [
    ...describeCandidateBound(candidates),
    ...describePlaceLimits(check.places ?? null),
  ];
  const limited = results.length > 0;

  if (hits.length === 0) {
    // "0 results." is a fact about the machine's own behaviour, and it is only a fact when the
    // machine wrote everything it found. A run whose cap refused every candidate found plenty and
    // recorded none, so the truncation sentence above is the whole and only account of it — appending
    // this one would state the exact opposite of what happened.
    if (candidates === null || !candidates.truncated) {
      // The only conclusion the platform draws, and it is a statement about the search ending rather
      // than about the matter. Nothing here may grow into a clearance.
      results.push("0 results.");
    }
  } else {
    const byTier = [...countByTier(hits)]
      .toSorted(([left], [right]) => left - right)
      .map(([tier, count]) => `tier ${tier}: ${count}`)
      .join(", ");
    // "Surfaced" and "recorded" are the same number on an unbounded run and are NOT on a bounded one,
    // so the closing sentence changes verb rather than letting the reader take a written count for
    // everything the channels found. The truncation sentence above carries the surfaced figure.
    const verb = candidates !== null && candidates.truncated ? "recorded" : "surfaced";
    results.push(`${counted(hits.length, "result", "results")} ${verb} for review (${byTier}).`);
  }
  sections.push(section("results", "Results", results, limited));
  return sections;
}
