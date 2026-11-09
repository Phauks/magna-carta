/*
 * The Results section of a check's report, as data: how each result is described, and how the
 * reader narrows the list. Kept apart from the component so the wording and the filtering can be
 * tested without a browser.
 *
 * EACH RESULT SAYS WHY AND WHERE (owner's ruling, 2026-11-09: "better verbosity for potential
 * results, and filtering"). A row used to be a party name and a tier number, and a reviewer had to
 * open it to learn anything. Now the card itself carries how strong the match is in words, which of
 * the check's searches found it, what fired, and how it was reached; opening it adds the full
 * account. Nothing here concludes anything: strength is a fact about the evidence, never about the
 * matter.
 *
 * THE ANSWER IS A REVIEW STATE, chosen from the card (the same ruling: the Answer button "seems
 * weird"). Not reviewed, Cleared, Waived, Walled off, Declined — the four kinds a reviewer records,
 * in short words, beside the state nobody has recorded yet.
 */
import type { DispositionKind, EvidenceTier, HitDetail, SourceClass } from "./conflicts-api.ts";
import { adjudicationSummary, edgeTypeLabel, sourceVocabulary } from "./conflicts-vocabulary.ts";
import { matchedOnText, partyText } from "./hit-columns.ts";

/** Where a result stands with its reviewer. */
export type ReviewState = "unreviewed" | DispositionKind;

export const REVIEW_STATES: readonly ReviewState[] = [
  "unreviewed",
  "cleared",
  "waiver_obtained",
  "wall_erected",
  "representation_declined",
];

export const REVIEW_LABELS: Readonly<Record<ReviewState, string>> = {
  unreviewed: "Not reviewed",
  cleared: "Cleared",
  waiver_obtained: "Waived",
  wall_erected: "Walled off",
  representation_declined: "Declined",
};

export function reviewStateOf(hit: HitDetail): ReviewState {
  return hit.disposition?.kind ?? "unreviewed";
}

/**
 * The review word a card shows. A waiver the platform cannot produce the record for says so in
 * words, the way every other surface does, rather than reading as a complete one.
 */
export function reviewText(hit: HitDetail): string {
  if (hit.disposition === null) return REVIEW_LABELS.unreviewed;
  if (hit.disposition.shortfalls.length > 0) return adjudicationSummary(hit.disposition).label;
  return REVIEW_LABELS[hit.disposition.kind];
}

/** How strong the evidence is, in a word per tier. Strongest first. */
export const STRENGTH_LABELS: Readonly<Record<EvidenceTier, string>> = {
  1: "Exact",
  2: "Same name",
  3: "Might be",
  4: "Weak",
};

export type StrengthTone = "danger" | "warning" | "info" | "neutral";

export const STRENGTH_TONES: Readonly<Record<EvidenceTier, StrengthTone>> = {
  1: "danger",
  2: "warning",
  3: "info",
  4: "neutral",
};

/** Which of the check's searches found the result, as the panel names that search. */
export function foundThroughText(source: SourceClass): string {
  return sourceVocabulary(source).label;
}

/** Why it surfaced: every channel that fired, in the engine's own words. */
export function whyText(hit: HitDetail): string {
  const why = matchedOnText(hit);
  return why === "" ? "Matched, with no channel recorded" : `Matched on ${why}`;
}

/** How it was reached: directly, as another party on this check, or through relationships. */
export function whereText(hit: HitDetail): string {
  if (hit.sourceClass === "imputation") return "One of the firm's own people";
  if (hit.coParty) return "Also a party on this check";
  if (hit.graphPath.length === 0) return "Found directly in the Directory";
  const steps = hit.graphPath.map((step) => edgeTypeLabel(step.edgeType)).join(", then ");
  const ended = hit.graphPath.some((step) => step.expiredAtCheck === true)
    ? " (a relationship had ended)"
    : "";
  return `Reached through ${steps}${ended}`;
}

/** What the reader has narrowed the list to. An empty set means no narrowing on that facet. */
export interface ResultFilter {
  readonly text: string;
  readonly sources: ReadonlySet<SourceClass>;
  readonly strengths: ReadonlySet<EvidenceTier>;
  readonly reviews: ReadonlySet<ReviewState>;
}

export const NO_FILTER: ResultFilter = {
  text: "",
  sources: new Set(),
  strengths: new Set(),
  reviews: new Set(),
};

export function filterIsActive(filter: ResultFilter): boolean {
  return (
    filter.text.trim() !== "" ||
    filter.sources.size > 0 ||
    filter.strengths.size > 0 ||
    filter.reviews.size > 0
  );
}

/** The results the filter keeps, strongest evidence first, in the order the engine wrote ties. */
export function filterResults(hits: readonly HitDetail[], filter: ResultFilter): HitDetail[] {
  const needle = filter.text.trim().toLowerCase();
  return hits
    .filter((hit) => filter.sources.size === 0 || filter.sources.has(hit.sourceClass))
    .filter((hit) => filter.strengths.size === 0 || filter.strengths.has(hit.evidenceTier))
    .filter((hit) => filter.reviews.size === 0 || filter.reviews.has(reviewStateOf(hit)))
    .filter(
      (hit) =>
        needle === "" ||
        partyText(hit).toLowerCase().includes(needle) ||
        hit.matchedFields.some((field) => field.toLowerCase().includes(needle)),
    )
    .toSorted((left, right) => left.evidenceTier - right.evidenceTier);
}

/** How many results carry each value of a facet, for the counts on its chips. */
export function countBy<Key>(
  hits: readonly HitDetail[],
  keyOf: (hit: HitDetail) => Key,
): Map<Key, number> {
  const counts = new Map<Key, number>();
  for (const hit of hits) counts.set(keyOf(hit), (counts.get(keyOf(hit)) ?? 0) + 1);
  return counts;
}

/** A set with one value toggled, for a chip pressed on or off. */
export function toggled<Value>(set: ReadonlySet<Value>, value: Value): Set<Value> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** "0 results", "1 result", "6 results". */
export function resultCountText(count: number): string {
  return `${String(count)} ${count === 1 ? "result" : "results"}`;
}
