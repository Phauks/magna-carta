import type { SourceAvailability, SourceClass } from "./types.ts";

// The one home for what a check CAN search, what it cannot, and — when it cannot — why.
//
// The write side and the read side of the log both need this and must never disagree: the check
// writes the availability, and the posture read and the report sentence explain it. Keeping the
// availability table and the explanations in one module is what stops a source from being recorded
// unavailable in one place and described as searched in another.

// A source key that appears in a check's recorded scope but is not one of the four SourceClass
// values. Lateral-hire history from a member's prior firm is a registered source with no table and no
// capture surface; registering it and recording it unavailable on every check is what keeps the log
// from implying the dimension was searched at all.
export const PRIOR_FIRM_HISTORY_SOURCE = "prior_firm_history";

// The classes with a corpus behind them today. The content class has none — nothing indexes document
// text, and the email parse core is not wired to a consumer — so it records `unavailable` rather than
// being omitted: a reader must be able to tell "searched and nothing surfaced" apart from "never
// searched".
const SOURCES_WITH_A_CORPUS: ReadonlySet<SourceClass> = new Set(["party", "graph", "imputation"]);

export function availabilityOf(sourceClass: SourceClass): SourceAvailability {
  return SOURCES_WITH_A_CORPUS.has(sourceClass) ? "searched" : "unavailable";
}

// How a source key reads in a sentence a lawyer is meant to understand. The stored key is a column
// value, not prose.
const SOURCE_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  party: "party",
  graph: "graph",
  imputation: "imputation",
  content: "content",
  [PRIOR_FIRM_HISTORY_SOURCE]: "prior-firm history",
};

export function displayNameForSource(source: string): string {
  return SOURCE_DISPLAY_NAMES[source] ?? source;
}

// Facts about the check being explained that change WHY a source could not run.
export interface UnavailabilityContext {
  // False for a pre-consult check against a prospective party set with no matter yet. Imputation
  // joins firm members against a matter's parties, so without one there is nothing to join.
  readonly hasSubjectMatter: boolean;
}

// Why a source recorded `unavailable`. The reason is DERIVED at read time rather than stored: it is a
// standing fact about the platform ("no document-text index exists"), not a fact about the run, and a
// stored copy on every check row would be a sentence that rots the day the corpus arrives.
//
// The fallback is deliberately an admission rather than a guess. A source recorded unavailable for a
// reason this table does not know about must read as unexplained, never as explained-away.
export function unavailabilityReason(source: string, context: UnavailabilityContext): string {
  if (source === "content") {
    return "no corpus exists: nothing indexes document text, and no message-body index is wired";
  }
  if (source === PRIOR_FIRM_HISTORY_SOURCE) {
    return "no data is recorded: the source is registered so that it is reported, and it has no table behind it yet";
  }
  if (source === "imputation" && !context.hasSubjectMatter) {
    return "no matter was supplied, so there were no matter parties to join the firm's members against";
  }
  return "the check recorded this source unavailable and recorded no reason";
}
