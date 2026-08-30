/*
 * How the conflicts subsystem's own words read on a screen — ONE map per catalogue, so no surface
 * picks its own wording or its own tone.
 *
 * EVERY WORD HERE IS THE DOMAIN'S, NOT THIS SURFACE'S. The source class, the strictness band, the
 * trigger, the disposition kind and the evidence tier are all closed catalogues the engine writes
 * into an append-only log, and a screen that renamed one of them would print a word the record does
 * not contain. So the keys are the stored values verbatim, and the labels are those values set for
 * a reader. A gate scans this tree for assertion vocabulary; the labels below are deliberately
 * facts about the search or about a named person's conclusion, and never about the matter.
 *
 * WHY THE TONES LIVE HERE AND NOT IN THE SHARED STATUS REGISTER. The register is the one home for a
 * status WORD the whole product speaks — Draft, Paid, Void. None of these words is one of those:
 * they are this subsystem's vocabulary and appear nowhere else, which is the same reason a matter's
 * lifecycle status has its own map beside the matters surface. Whether the conflicts vocabulary
 * graduates into the shared register is a design-system decision, and until it does the tones are
 * settled once, here.
 *
 * THE ONLY LOUD THING IS AN OPEN QUESTION. The warning tone on this surface marks a question the
 * record leaves open, and nothing else; what a reviewer CONCLUDED reads calm, whatever it was. That
 * is the reading rule the whole subsystem turns on: the platform may state that a question is open,
 * and may never grade the answer a lawyer gave it.
 *
 * There are two open questions, not one. A hit nobody has answered is the first. The second is a
 * waiver whose record names evidence the platform does not hold — informed consent not confirmed in
 * writing, or a confirmation nobody filed here. That is a fact about the platform's own holdings,
 * not a verdict on the reviewer: it says what the firm could not produce if somebody asked for it
 * this afternoon. It has to be loud for the same reason the first one does — an unevidenced waiver
 * that reads exactly like an evidenced one is the failure the waiver record exists to prevent — and
 * it says so in WORDS as well as in colour, because a tone alone is not a fact anybody can read.
 */
import type { BadgeVariant } from "@magna-carta/design-system/badge";
import { statusEntry, type StatusKey } from "@magna-carta/design-system/status-register";
import type {
  ConflictsTrigger,
  DispositionKind,
  EvidenceTier,
  SourceClass,
  Strictness,
  WaiverShortfall,
} from "./conflicts-api.ts";

/** A catalogue word, set for a reader: what it says, and what it means on the hover. */
export interface VocabularyEntry {
  label: string;
  meaning: string;
}

/** A catalogue word that also wears a chip. */
export interface ChipVocabularyEntry extends VocabularyEntry {
  tone: BadgeVariant;
}

// ---- evidence tier ----------------------------------------------------------------------------

/**
 * The tiers, strongest first. A tier ORDERS a reviewer's queue and nothing more: there is no
 * threshold anywhere in the engine, and a candidate with no recorded signal still lands at tier 4
 * rather than disappearing. So the label is the ordinal itself — a word like "critical" would be a
 * grade the engine deliberately refuses to give.
 */
export const EVIDENCE_TIERS: readonly EvidenceTier[] = [1, 2, 3, 4];

export const EVIDENCE_TIER_VOCABULARY: Readonly<Record<EvidenceTier, VocabularyEntry>> = {
  1: {
    label: "Tier 1",
    meaning: "An exact identifier match, by blind index over a sealed identifier.",
  },
  2: {
    label: "Tier 2",
    meaning: "These are the same name: an exact normalized name, or one name written two ways.",
  },
  3: {
    label: "Tier 3",
    meaning:
      "These might be the same: the same name under a different legal form, or a phonetic code match.",
  },
  4: {
    label: "Tier 4",
    meaning:
      "Trigram overlap alone. No tier is ever filtered out, so a weak signal still surfaces.",
  },
};

/** How one tier reads. */
export function evidenceTier(tier: EvidenceTier): VocabularyEntry {
  return EVIDENCE_TIER_VOCABULARY[tier];
}

// ---- source class -----------------------------------------------------------------------------

export const SOURCE_CLASSES: readonly SourceClass[] = ["party", "graph", "imputation", "content"];

/**
 * Every source a check records, including the two that carry no class of their own. Both of those
 * are registered precisely so a check reports them: a dimension quietly missing from a list of what
 * ran is indistinguishable from a dimension that was searched and found nothing.
 */
export const PRIOR_FIRM_HISTORY_SOURCE = "prior_firm_history";
export const NICKNAME_EQUIVALENCE_SOURCE = "nickname_equivalence";

export const SOURCE_VOCABULARY: Readonly<Record<string, VocabularyEntry>> = {
  party: {
    label: "Party",
    meaning: "Name and identifier similarity over the firm's whole Directory.",
  },
  graph: {
    label: "Graph",
    meaning: "Reached by traversing a recorded relationship out from a subject party.",
  },
  imputation: {
    label: "Imputation",
    meaning:
      "An identity join between the matter's parties and the firm's own members. Never a name match.",
  },
  content: {
    label: "Content",
    meaning: "Message participants and document text. No corpus exists behind it yet.",
  },
  [PRIOR_FIRM_HISTORY_SOURCE]: {
    label: "Prior-firm history",
    meaning:
      "What a lateral hire brought with them. Registered so it is reported; it holds no data.",
  },
  [NICKNAME_EQUIVALENCE_SOURCE]: {
    label: "Nickname equivalents",
    meaning:
      "Bob and Robert are not a phonetic relationship. The catalogue exists and is shipped empty.",
  },
};

/** How one source reads. An unknown key prints itself rather than being explained away. */
export function sourceVocabulary(source: string): VocabularyEntry {
  return SOURCE_VOCABULARY[source] ?? { label: source, meaning: "" };
}

// ---- strictness -------------------------------------------------------------------------------

export const STRICTNESS_LEVELS: readonly Strictness[] = ["balanced", "over_inclusive"];

export const STRICTNESS_VOCABULARY: Readonly<Record<Strictness, VocabularyEntry>> = {
  balanced: {
    label: "Balanced",
    meaning: "The firm's configured name roles and the primary phonetic encoder.",
  },
  over_inclusive: {
    label: "Over-inclusive",
    meaning:
      "Every name role the corpus holds and every encoder. A strict superset of balanced: raising it can only add candidates.",
  },
};

/** How one strictness band reads. An unrecognized stored word prints itself. */
export function strictnessVocabulary(strictness: string): VocabularyEntry {
  return (
    STRICTNESS_VOCABULARY[strictness as Strictness] ?? {
      label: strictness,
      meaning: "This build does not recognize the band this check ran under.",
    }
  );
}

// ---- trigger ----------------------------------------------------------------------------------

/**
 * Why a check ran. A trigger names the EVENT, never the outcome, because a run the firm's system
 * started when two records merged and a run somebody clicked are different claims about how
 * thorough the firm's procedure is, and only the first one is a procedure.
 */
export const TRIGGER_VOCABULARY: Readonly<Record<ConflictsTrigger, VocabularyEntry>> = {
  preliminary: {
    label: "Preliminary",
    meaning: "Before the firm has taken the matter on: the pre-consult screen.",
  },
  comprehensive: {
    label: "Comprehensive",
    meaning: "The engagement moment: every live party, at the point the firm accepts.",
  },
  new_party: {
    label: "New Party",
    meaning: "A party was added to a matter the firm had already checked.",
  },
  entity_merged: {
    label: "Entity Merged",
    meaning: "Two Directory records became one, and the union may not read as either did.",
  },
  entity_renamed: {
    label: "Entity Renamed",
    meaning: "A new alias, maiden, former or trading name makes matches possible that were not.",
  },
  relationship_recorded: {
    label: "Relationship Recorded",
    meaning: "A corporate parent, a spouse or a principal link was recorded after the last check.",
  },
  identifier_recorded: {
    label: "Identifier Recorded",
    meaning: "An identifier entered later makes an exact identifier match possible.",
  },
  personnel_changed: {
    label: "Personnel Changed",
    meaning: "The firm's own roster moved, so what is imputed to the firm moved with it.",
  },
  periodic_rescan: {
    label: "Periodic Re-scan",
    meaning: "The clock-driven backstop, at the cadence the firm set.",
  },
};

/** How one trigger reads. The catalogue is open on the contract, so an unknown word prints itself. */
export function triggerVocabulary(trigger: string): VocabularyEntry {
  return (
    TRIGGER_VOCABULARY[trigger as ConflictsTrigger] ?? {
      label: trigger,
      meaning: "A trigger this build has not been told about.",
    }
  );
}

/**
 * The triggers a person may choose when they run a check by hand.
 *
 * The others name an event or the clock, and a run a person started is not one of those. Offering
 * them would let somebody file a manual run under a word that claims the firm's system caught
 * something, which is exactly the claim the trigger column exists to keep honest.
 */
export const OPERATOR_TRIGGERS: readonly ConflictsTrigger[] = ["preliminary", "comprehensive"];

// ---- disposition ------------------------------------------------------------------------------

export const DISPOSITION_KINDS: readonly DispositionKind[] = [
  "cleared",
  "waiver_obtained",
  "wall_erected",
  "representation_declined",
];

/**
 * A reviewer's adjudication of one hit — the one place in this subsystem where a conclusion is
 * drawn, and it is drawn by a named person on a row carrying their identity and their reasoning.
 *
 * The words and their tones come from the design system's status register, where a status word is
 * given one label and one tone for the whole product. The tones there are calm on purpose, and for
 * this reason: what a reviewer concluded is their professional judgement, and a green tick or a red
 * block beside it would be the platform grading it. The wire spells these kinds with underscores
 * and the register spells them with hyphens, so the crossing is written out once here.
 */
const DISPOSITION_STATUS_KEYS: Readonly<Record<DispositionKind, StatusKey>> = {
  cleared: "cleared",
  waiver_obtained: "waiver-obtained",
  wall_erected: "wall-erected",
  representation_declined: "representation-declined",
};

/** How one adjudication reads. */
export function dispositionVocabulary(kind: DispositionKind): ChipVocabularyEntry {
  const entry = statusEntry(DISPOSITION_STATUS_KEYS[kind]);
  return { label: entry.label, tone: entry.tone, meaning: entry.meaning };
}

// ---- what a waiver's record is short of ---------------------------------------------------------

/**
 * The four ways a recorded waiver can be short of what a firm would be asked to produce.
 *
 * Each sentence describes THE RECORD, never the waiver and never the reviewer: "the platform does
 * not hold X" is a fact it is entitled to state, where "this waiver is invalid" would be a
 * conclusion it has no standing to draw. A reviewer may have the signed letter in a drawer; what
 * this says is that the platform cannot hand it over.
 */
export const WAIVER_SHORTFALL_VOCABULARY: Readonly<Record<WaiverShortfall, string>> = {
  "consenting-party-unrecorded": "The record does not name who gave the waiver.",
  "consent-not-confirmed-in-writing":
    "The consent is not recorded as confirmed in writing, which is the form the rules ask for.",
  "confirmation-not-filed": "No filed document evidencing the confirmation is on the record.",
  "date-given-unrecorded": "The record does not say when the waiver was given.",
};

/** How one shortfall reads. An unrecognized value prints itself rather than being explained away. */
export function waiverShortfallText(shortfall: WaiverShortfall): string {
  return WAIVER_SHORTFALL_VOCABULARY[shortfall] ?? shortfall;
}

/**
 * A waiver the platform cannot produce the record for.
 *
 * The label carries the fact in words, not only in tone: in a table cell, a colour that differs from
 * a complete waiver's and a caption that does not is a difference nobody reads and a screen reader
 * cannot say at all.
 */
export const INCOMPLETE_WAIVER_LABEL = "Waiver — Incomplete Record";

/**
 * What a hit nobody has answered wears — the one loud thing on this surface.
 *
 * It is a fact about the platform's own record (no reviewer has adjudicated this hit), never a fact
 * about the matter, which is why it is allowed to be the thing that shouts.
 */
export const UNANSWERED: ChipVocabularyEntry = (() => {
  const entry = statusEntry("unanswered");
  return { label: entry.label, tone: entry.tone, meaning: entry.meaning };
})();
/** How a hit's adjudication column reads, answered or not. */
export function adjudicationChip(kind: DispositionKind | null): ChipVocabularyEntry {
  return kind === null ? UNANSWERED : dispositionVocabulary(kind);
}

/**
 * How a hit's adjudication reads with its record taken into account — the form every surface uses.
 *
 * Three outcomes: nobody has answered; somebody answered and the platform holds the whole record;
 * somebody answered a waiver and the platform is short of part of it. The third must never render
 * as the second, which is why surfaces take this rather than the kind's chip on its own.
 */
export function adjudicationSummary(
  disposition: { kind: DispositionKind; shortfalls: readonly WaiverShortfall[] } | null,
): ChipVocabularyEntry {
  if (disposition === null) return UNANSWERED;
  if (disposition.shortfalls.length === 0) return dispositionVocabulary(disposition.kind);
  return {
    label: INCOMPLETE_WAIVER_LABEL,
    tone: "warning",
    meaning: disposition.shortfalls.map((shortfall) => waiverShortfallText(shortfall)).join(" "),
  };
}

// ---- what made a re-check owed ------------------------------------------------------------------

/**
 * The corpus changes that can leave a matter's last check answering a question the record no longer
 * asks. Each is a fact about the firm's own records moving, and the point of listing them is that a
 * matter whose corpus moved says so from the moment the change commits rather than from whenever a
 * consumer gets round to it.
 */
export const CAUSE_TOPIC_VOCABULARY: Readonly<Record<string, string>> = {
  "matter.created": "The matter was created",
  "matter.opened": "The matter was opened",
  "matter.reopened": "The matter was reopened",
  "matter_party.linked": "A party was added to the matter",
  "directory.entity.merged": "Two Directory records were merged",
  "directory.entity.renamed": "A Directory record gained another name",
  "directory.edge.created": "A relationship was recorded",
  "directory.identifier.added": "An identifier was recorded",
  "member.provisioned": "The firm's roster changed",
};

/** How a cause reads. An unknown topic prints itself rather than being explained away. */
export function causeTopicLabel(topic: string): string {
  return CAUSE_TOPIC_VOCABULARY[topic] ?? topic;
}

// ---- the relationship graph --------------------------------------------------------------------

/**
 * Which class an edge type belongs to. The classes exist because one integer cannot express "follow
 * a corporate rename chain forever but do not walk from a spouse to her employer's other
 * directors" — those are different questions about what a relationship MEANS.
 */
export const EDGE_CLASS_BY_TYPE: Readonly<Record<string, string>> = {
  corporate_parent: "corporate",
  corporate_subsidiary: "corporate",
  corporate_successor: "corporate",
  affiliation: "control",
  relationship: "family",
  representation: "representation",
  role_assignment: "representation",
};

export const EDGE_CLASS_VOCABULARY: Readonly<Record<string, VocabularyEntry>> = {
  corporate: {
    label: "Corporate family",
    meaning:
      "The same legal person continuing under another name or shell. Traversed transitively, bounded only by the closure cap.",
  },
  control: { label: "Control", meaning: "Who directs whom." },
  family: { label: "Family", meaning: "A personal relationship between two people." },
  representation: {
    label: "Representation",
    meaning: "A role link recorded as a relationship rather than as a party row.",
  },
};

/** The three classes that carry a hop budget. Corporate family carries none, deliberately. */
export const BUDGETED_EDGE_CLASSES = ["control", "family", "representation"] as const;

/** How one edge type reads on a path. An unknown type prints itself rather than being guessed at. */
export function edgeTypeLabel(edgeType: string): string {
  const edgeClass = EDGE_CLASS_BY_TYPE[edgeType];
  if (edgeClass === undefined) return edgeType;
  return `${EDGE_CLASS_VOCABULARY[edgeClass]?.label ?? edgeClass}: ${edgeType.replaceAll("_", " ")}`;
}

/** How one edge class reads. */
export function edgeClassLabel(edgeClass: string): string {
  return EDGE_CLASS_VOCABULARY[edgeClass]?.label ?? edgeClass;
}

// ---- the connecting path ------------------------------------------------------------------------

/**
 * How a hit was reached, in one phrase.
 *
 * A hit with no path is the subject party itself matching, which is a direct match rather than a
 * relationship; anything else is reached through that many recorded relationships. The number of
 * hops is the fact a reviewer triages on, because a conflict two relationships out is a different
 * question from one standing directly in front of them.
 */
export function pathSummary(steps: readonly { expiredAtCheck?: boolean }[]): string {
  if (steps.length === 0) return "Direct";
  const ended = steps.filter((step) => step.expiredAtCheck === true).length;
  const hops = `${String(steps.length)} ${steps.length === 1 ? "relationship" : "relationships"}`;
  return ended === 0 ? hops : `${hops} (${String(ended)} ended)`;
}
