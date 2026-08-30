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
  adjudicationChip,
  evidenceTier,
  pathSummary,
  sourceVocabulary,
} from "./conflicts-vocabulary.ts";
import { gapCellTitle } from "./conflicts-gaps.ts";

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

/** What the adjudication column says: the reviewer's latest word, or that nobody has answered. */
export function adjudicationText(hit: HitDetail): string {
  return adjudicationChip(hit.disposition?.kind ?? null).label;
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
      // Real column, unread value. The hover carries what it waits on; the cell shows the gap.
      value: () => null,
      text: () => "",
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

/** What the unread Party cell's hover says. */
export function partyCellTitle(): string {
  return gapCellTitle("matchedPartyName");
}
