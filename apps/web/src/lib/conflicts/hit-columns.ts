/*
 * The hit list's declarative column model — what the one table is told about what a check surfaced.
 * Pure: it takes nothing but the rows and returns columns, so what a column IS stays unit-testable
 * and there is one place to change it. The screen owns fetching and rendering.
 *
 * THE TIER ANCHORS THE ROW, AND IT IS AN ORDINAL RATHER THAN A GRADE. The engine assigns a tier by
 * WHAT KIND of thing matched, never by how probable the match is, and no tier is ever filtered out
 * — a candidate with no recorded signal still lands at tier 4. So the column leads, it sorts
 * strongest-first, and it is never hidden; and it is labelled with the ordinal rather than with a
 * severity word the engine deliberately refuses to give.
 *
 * WHY THERE IS A PARTY COLUMN THAT CANNOT SPEAK. A hit answers an entity identifier and nothing
 * else about who matched, and no read names many entities in one request. Naming every row would be
 * one request per row. Dropping the column instead would leave a reader unable to tell a product
 * that cannot yet say from a hit that has no party, so the column is real, states its gap on the
 * hover, and the party is named where a reviewer opens one hit and one read answers it.
 *
 * AN UNEVIDENCED WAIVER IS NOT A WAIVER, AS FAR AS THIS COLUMN IS CONCERNED. A disposition whose
 * record the platform cannot produce — informed consent not confirmed in writing, or a confirmation
 * nobody filed — reads and filters as its own value rather than sharing a cell with one the firm
 * could hand over this afternoon. That is a fact about the record, not a grade of the reviewer.
 *
 * A CO-PARTY SURFACING IS TRIAGED APART. A match that lands back on one of the check's own subject
 * parties is a positional question between two parties of the same matter; a match anywhere else is
 * a question about the firm's wider record. They are never dropped and never merged, so the column
 * says which.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import { entityKindFromIdentifier } from "$lib/directory/directory-api.ts";
import { entityKindLabel } from "$lib/directory/entity-presentation.ts";
import type { HitDetail } from "./conflicts-api.ts";
import {
  adjudicationSummary,
  evidenceTier,
  pathSummary,
  sourceVocabulary,
} from "./conflicts-vocabulary.ts";

/** The column identities, so the screen's cell snippet and the model cannot drift apart. */
export const HIT_COLUMN_IDENTIFIERS = {
  tier: "tier",
  party: "party",
  entityKind: "entityKind",
  source: "source",
  matchedOn: "matchedOn",
  reachedThrough: "reachedThrough",
  surfacedAgainst: "surfacedAgainst",
  adjudication: "adjudication",
  surfacedAt: "surfacedAt",
} as const;

/** Strongest evidence first. A reviewer's queue is ordered by what kind of thing matched. */
export const HIT_INITIAL_SORT = {
  columnId: HIT_COLUMN_IDENTIFIERS.tier,
  direction: "ascending",
} as const;

/**
 * How an entity handle's own type tag reads. It is the one fact about a matched entity the hit
 * itself carries, which is why it can be shown on every row where the name cannot.
 */
export function entityKindText(entityId: string): string {
  const kind = entityKindFromIdentifier(entityId);
  return kind === null ? "" : entityKindLabel(kind);
}

/** Which side of the triage a hit falls on. */
export const SURFACED_AGAINST_SUBJECT = "Subject party";
export const SURFACED_AGAINST_DIRECTORY = "Elsewhere in the Directory";

export function surfacedAgainstText(hit: HitDetail): string {
  return hit.coParty ? SURFACED_AGAINST_SUBJECT : SURFACED_AGAINST_DIRECTORY;
}

/**
 * Every channel that fired, in the engine's own words, joined for one cell.
 *
 * The stored explanation lists EVERY channel rather than only the tier-setting one, because a
 * reviewer adjudicates on it and an auditor reads it years later. Nothing here summarizes it: a hit
 * a lawyer cannot explain is a hit they cannot act on.
 */
export function matchedOnText(hit: HitDetail): string {
  return hit.matchedFields.join("; ");
}

/**
 * What the adjudication column says: the reviewer's latest word, that nobody has answered, or that
 * the answer names evidence the platform does not hold.
 *
 * The third reads differently in TEXT, not only in tone, because this string is also what the
 * column's set filter groups by — a reviewer narrowing to waivers they still owe a confirmation for
 * is doing it here.
 */
export function adjudicationText(hit: HitDetail): string {
  return adjudicationSummary(hit.disposition).label;
}

/** The hit list's columns. Sorting, filtering, show/hide, reorder, pinning and resize are the grid's. */
export function hitColumns(): GridColumn<HitDetail>[] {
  return [
    {
      id: HIT_COLUMN_IDENTIFIERS.tier,
      label: "Tier",
      anchored: true,
      filter: "set",
      value: (hit) => evidenceTier(hit.evidenceTier).label,
    },
    {
      id: HIT_COLUMN_IDENTIFIERS.party,
      label: "Party",
      filter: "set",
      // The name the Directory holds TODAY, which the server resolves on the read rather than
      // copying onto the append-only log — so a reviewer deciding now is looking at the current
      // name rather than the one that was current when the check ran.
      value: (hit) => partyText(hit),
    },
    {
      id: HIT_COLUMN_IDENTIFIERS.entityKind,
      label: "Kind",
      filter: "set",
      value: (hit) => entityKindText(hit.entityId),
    },
    {
      id: HIT_COLUMN_IDENTIFIERS.source,
      label: "Source",
      filter: "set",
      value: (hit) => sourceVocabulary(hit.sourceClass).label,
    },
    {
      id: HIT_COLUMN_IDENTIFIERS.matchedOn,
      label: "Matched On",
      value: matchedOnText,
    },
    {
      id: HIT_COLUMN_IDENTIFIERS.reachedThrough,
      label: "Reached Through",
      filter: "set",
      value: (hit) => pathSummary(hit.graphPath),
    },
    {
      id: HIT_COLUMN_IDENTIFIERS.surfacedAgainst,
      label: "Surfaced Against",
      filter: "set",
      value: surfacedAgainstText,
    },
    {
      id: HIT_COLUMN_IDENTIFIERS.adjudication,
      label: "Adjudication",
      filter: "set",
      value: adjudicationText,
    },
    {
      id: HIT_COLUMN_IDENTIFIERS.surfacedAt,
      label: "Surfaced",
      type: "date",
      // Every hit of one check was written by that one check, so the column repeats one instant on
      // every row. The columns menu offers it for a reader who wants it stated.
      hidden: true,
      value: (hit) => hit.createdAt,
    },
  ];
}

/*
 * How a hit's party reads, including the two ways it can fail to name anybody. Neither is blank and
 * neither reads as "no party": a conflicts hit always HAS a party, and a cell that said otherwise
 * would invert the one thing the row is for.
 *
 *   - the entity does not resolve — the firm merged it away after this check was written, which the
 *     append-only log makes reachable. The row says so and the hover names the id.
 *   - the record resolves and carries no name at all. Rarer, and a different fact: the Directory
 *     holds it, nobody has named it.
 */
export function partyText(hit: HitDetail): string {
  if (hit.party === null) return "Entity not resolved";
  return hit.party.displayName ?? "Unnamed record";
}

/** What the Party cell's hover says, where the cell could not name anybody. */
export function partyCellTitle(hit: HitDetail): string | undefined {
  if (hit.party === null) {
    return `This check found ${hit.entityId}, which is no longer in the Directory, usually because the record was merged after the check ran. The result still names what it matched.`;
  }
  if (hit.party.displayName === null) {
    return `The Directory record ${hit.entityId} has no name.`;
  }
  return undefined;
}
