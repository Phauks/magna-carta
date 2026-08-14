export type {
  ConflictsCheckId,
  ConflictsHitId,
  ConflictsDispositionId,
} from "@magna-carta/identifiers/types";

// The four classes of thing a check can search. They differ in HOW they match, not only in what
// they search: party and graph match by similarity, imputation matches by identity only, and content
// is exact-address equality (email participants) or unstructured mention (bodies, document text).
export const SOURCE_CLASSES = ["party", "graph", "imputation", "content"] as const;
export type SourceClass = (typeof SOURCE_CLASSES)[number];

// Strictness is a recall knob, not a threshold: it selects which channels run and which name rows
// they see. It never suppresses a hit. over_inclusive returns a strict superset of balanced.
export const STRICTNESS_LEVELS = ["balanced", "over_inclusive"] as const;
export type Strictness = (typeof STRICTNESS_LEVELS)[number];

// Why a check ran. The column carries a `length > 0` CHECK rather than an enumeration, so widening
// this catalogue is additive — no migration, and no rebuild of a growing append-only table.
//
// A trigger names the EVENT, never the outcome: reading a check back has to say what set it going,
// because "run because two Directory records were merged" and "run because somebody clicked" are
// different claims about how thorough a firm's procedure is, and only the first one is a procedure.
export const CONFLICTS_TRIGGERS = [
  "preliminary",
  "comprehensive",
  "new_party",
  "entity_merged",
  "entity_renamed",
  "relationship_recorded",
  "identifier_recorded",
  "personnel_changed",
  "periodic_rescan",
] as const;
export type ConflictsTrigger = (typeof CONFLICTS_TRIGGERS)[number];

// What started a run, kept beside the actor rather than derived from it. An absent actor says nobody
// is being credited with the run; it does not say whether a person, an event, or the clock set it
// going, and a report that reads "run automatically because entity X was merged" needs to know which.
// NULL on every row written before the automated paths existed, and on any run a person asked for.
export const CONFLICTS_TRIGGER_SOURCES = ["manual", "event", "schedule"] as const;
export type ConflictsTriggerSource = (typeof CONFLICTS_TRIGGER_SOURCES)[number];

// One corpus change a check covers: the topic that announced it, the handle it is about, and when it
// happened. Recorded on the check as an array, because several accumulated causes collapse into ONE
// check that names them all — coalescing must never collapse a cause out of existence.
export interface ConflictsCause {
  readonly topic: string;
  readonly reference: string;
  readonly occurredAt: string;
}

export const DISPOSITION_KINDS = [
  "cleared",
  "waiver_obtained",
  "wall_erected",
  "representation_declined",
] as const;
export type DispositionKind = (typeof DISPOSITION_KINDS)[number];

// "unavailable" is not "clean". A source that could not run must never read as searched-and-empty.
export const SOURCE_AVAILABILITIES = ["searched", "unavailable"] as const;
export type SourceAvailability = (typeof SOURCE_AVAILABILITIES)[number];

// Ordering only. 1 is the strongest evidence. No tier is ever filtered out.
export type EvidenceTier = 1 | 2 | 3 | 4;

// What matched, per candidate. Drives tier assignment and is stored verbatim as the hit's explanation.
export interface MatchEvidence {
  readonly identifierTypes: readonly string[];
  readonly exactNormalizedName: boolean;
  readonly phoneticMatch: boolean;
  readonly trigramMatch: boolean;
}

// One hop of the connecting path from a subject party to a surfaced entity.
export interface EdgeStep {
  readonly edgeId: string;
  readonly edgeType: string;
  readonly fromEntityId: string;
  readonly toEntityId: string;
}
