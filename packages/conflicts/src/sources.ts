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

// The nickname equivalence dimension. `Bob`/`Robert` is not a phonetic relationship and no encoder
// derives it; it needs a curated catalogue, and the platform ships that catalogue empty. Registering
// the source here and recording it on every check is what turns "we have not built this" into
// something a reader of the log can see, rather than a dimension quietly missing from a list of what
// ran. Same posture as prior-firm history above, for the same reason.
export const NICKNAME_EQUIVALENCE_SOURCE = "nickname_equivalence";

// The assistant's conversations: a party named in a conversation with Magnus is a party the firm has
// heard of. A check searches them when it is asked to (content-search.ts). Rows written before that
// recorded the key `unavailable` on every check, which is why the reason below still exists.
export const MAGNUS_CONVERSATIONS_SOURCE = "magnus_conversations";

// The firm's calls, texts and email, and its tasks: searched when a check is asked to, recorded
// `searched` then and absent otherwise, exactly like a Directory technique nobody asked for.
export const MESSAGING_SOURCE = "messaging";
export const TASKS_SOURCE = "tasks";

// Every registered source with no class of its own, in the order the record lists them. A check
// writes all of them; a reader of an older row treats an absent key as the row not saying.
export const REGISTERED_SOURCES_WITHOUT_A_CLASS: readonly string[] = [
  PRIOR_FIRM_HISTORY_SOURCE,
  NICKNAME_EQUIVALENCE_SOURCE,
  MAGNUS_CONVERSATIONS_SOURCE,
];

// The classes with a corpus behind them today. The content class has none — nothing indexes document
// text, and the email parse core is not wired to a consumer — so it records `unavailable` rather than
// being omitted: a reader must be able to tell "searched and nothing surfaced" apart from "never
// searched".
const SOURCES_WITH_A_CORPUS: ReadonlySet<SourceClass> = new Set(["party", "graph", "imputation"]);

export function availabilityOf(sourceClass: SourceClass): SourceAvailability {
  return SOURCES_WITH_A_CORPUS.has(sourceClass) ? "searched" : "unavailable";
}

// WHERE A SOURCE LIVES. The owner's direction of 2026-09-11 (docs/conventions/conflicts-rulings.md,
// P3): a check is asked for by PLACE — the Directory, the firm's files, its messaging, its Magnus
// conversations — and the technique keys above are what the record stores. This map is the one
// crossing between the two, so an old row keyed by technique still reads as a place, and a new
// place is an entry here rather than a redesign. The content class is what document text and
// message bodies will both be searched through, so it sits under both places until the two grow
// corpora of their own; the two dimensions (prior-firm history, nickname equivalents) are not
// places at all and carry none.
export const SEARCH_LOCATIONS = ["directory", "files", "messaging", "tasks", "magnus"] as const;
export type SearchLocation = (typeof SEARCH_LOCATIONS)[number];

const LOCATIONS_BY_SOURCE: Readonly<Record<string, readonly SearchLocation[]>> = {
  party: ["directory"],
  graph: ["directory"],
  imputation: ["directory"],
  content: ["files", "messaging"],
  [MESSAGING_SOURCE]: ["messaging"],
  [TASKS_SOURCE]: ["tasks"],
  [MAGNUS_CONVERSATIONS_SOURCE]: ["magnus"],
};

export function locationsOfSource(source: string): readonly SearchLocation[] {
  return LOCATIONS_BY_SOURCE[source] ?? [];
}

// How a source key reads in a sentence a lawyer is meant to understand. The stored key is a column
// value, not prose.
const SOURCE_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  party: "party",
  graph: "graph",
  imputation: "imputation",
  content: "content",
  [PRIOR_FIRM_HISTORY_SOURCE]: "prior-firm history",
  [NICKNAME_EQUIVALENCE_SOURCE]: "nickname equivalents",
  [MESSAGING_SOURCE]: "calls, texts and email",
  [TASKS_SOURCE]: "tasks",
  [MAGNUS_CONVERSATIONS_SOURCE]: "Magnus conversations",
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
  if (source === NICKNAME_EQUIVALENCE_SOURCE) {
    return "no equivalents are curated: the catalogue exists and holds nothing, so no name was compared against a nickname of itself";
  }
  if (source === MAGNUS_CONVERSATIONS_SOURCE) {
    return "no conversation index exists: nothing reads a party's name out of a Magnus conversation";
  }
  if (source === "imputation" && !context.hasSubjectMatter) {
    return "no matter was supplied, so there were no matter parties to join the firm's members against";
  }
  return "the check recorded this source unavailable and recorded no reason";
}
