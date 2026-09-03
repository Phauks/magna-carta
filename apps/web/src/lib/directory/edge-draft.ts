/*
 * The rules a directory record follows when it records a NEW relationship, kept apart from the
 * pane that draws them so they can be asserted without a browser.
 *
 * DIRECTION IS THE TYPE'S, NEVER THE SCREEN'S. An officer is an officer OF an organization, and
 * that stays true whether the edge is recorded from the person's record or from the organization's.
 * So the ends of a new edge are decided by which end of the type the record can honestly stand at,
 * and the sentence a row reads is always the type's own reading: "Jane Okafor is an officer of
 * Meridian Holdings", from either record. A sentence that flipped to suit whichever record was open
 * would put a subsidiary in charge of its parent.
 *
 * What a pane OFFERS is narrower than what the catalog holds. The Relationships pane offers every
 * type this record can be an end of; the People pane on an organization and the Organizations pane
 * on a person offer only the membership family, because those panes list exactly the edges that
 * put a person inside an organization, and an edge added there that the pane would not then show
 * is an edge that vanishes the moment it is recorded.
 */
import type { DirectoryEdgeEntry, DirectoryEntityKind } from "./directory-api.ts";
import { EDGE_TYPES, MEMBERSHIP_EDGE_TYPES, type EdgeTypeEntry } from "./directory-vocabulary.ts";

/** Which of the record's edges a pane lists: all of them, or one side of the membership family. */
export type EdgePaneFilter = "all" | "people" | "organizations";

/** What is known about the record an edge is recorded from. */
export interface EdgeRecordEnd {
  id: string;
  kind: DirectoryEntityKind;
}

/** What is known about the entity picked as the far end. */
export interface EdgePickedEnd {
  identifier: string;
  kind: DirectoryEntityKind;
}

/** The two kinds, in the order the picker offers them. */
export const EVERY_ENTITY_KIND: readonly DirectoryEntityKind[] = ["person", "organization"];

function endAdmits(end: DirectoryEntityKind | "both", kind: DirectoryEntityKind): boolean {
  return end === "both" || end === kind;
}

/**
 * The types a record of this kind may record a new edge of: offered, and with at least one end
 * this kind can stand at. An organization is offered Officer (it is the target) and Subsidiary
 * (it is either end); a person is offered neither Corporate parent nor Subsidiary.
 */
export function offeredEdgeTypesForRecord(kind: DirectoryEntityKind): readonly EdgeTypeEntry[] {
  return EDGE_TYPES.filter(
    (entry) =>
      entry.offered && (endAdmits(entry.ends.from, kind) || endAdmits(entry.ends.to, kind)),
  );
}

/**
 * Whether the record stands at the type's origin, given who is at the other end. The type decides:
 * where only one arrangement of the two ends fits, that is the one. Where both fit — Trustee and
 * Agent admit either kind at either end — the record is the origin, except on a membership type
 * with a person at one end and an organization at the other, where the family's own meaning (a
 * person inside an organization) makes the person the origin. With nobody picked yet, the record
 * leads wherever the type lets it.
 */
export function recordIsOrigin(
  record: DirectoryEntityKind,
  picked: DirectoryEntityKind | null,
  entry: EdgeTypeEntry,
): boolean {
  const originFits =
    endAdmits(entry.ends.from, record) && (picked === null || endAdmits(entry.ends.to, picked));
  const targetFits =
    endAdmits(entry.ends.to, record) && (picked === null || endAdmits(entry.ends.from, picked));
  if (originFits && !targetFits) return true;
  if (targetFits && !originFits) return false;
  const membership = MEMBERSHIP_EDGE_TYPES.some((edgeType) => edgeType === entry.edgeType);
  if (membership && record === "organization" && picked === "person") return false;
  return true;
}

/**
 * Whether an entity of this kind may stand at the far end of an edge of this type from this
 * record, in some arrangement the type admits.
 */
export function pickedKindFits(
  record: DirectoryEntityKind,
  picked: DirectoryEntityKind,
  entry: EdgeTypeEntry,
): boolean {
  return farKindsFor(record, entry).includes(picked);
}

/** The two ends of a new edge, in the type's direction, whichever record it was recorded from. */
export function edgeEndsFor(
  record: EdgeRecordEnd,
  picked: EdgePickedEnd,
  entry: EdgeTypeEntry,
): { from: string; to: string } {
  return recordIsOrigin(record.kind, picked.kind, entry)
    ? { from: record.id, to: picked.identifier }
    : { from: picked.identifier, to: record.id };
}

/**
 * Which kinds the picker offers for the far end of an edge of this type: the end the record is not
 * on, in every arrangement the type admits the record in. Shareholder admits an organization at
 * either end, so from an organization's record the far end may be a person holding its shares or
 * an organization whose shares it holds; which arrangement was meant is settled by who is picked.
 */
export function farKindsFor(
  record: DirectoryEntityKind,
  entry: EdgeTypeEntry,
): readonly DirectoryEntityKind[] {
  const farEnds: (DirectoryEntityKind | "both")[] = [];
  if (endAdmits(entry.ends.from, record)) farEnds.push(entry.ends.to);
  if (endAdmits(entry.ends.to, record)) farEnds.push(entry.ends.from);
  return EVERY_ENTITY_KIND.filter((kind) => farEnds.some((end) => endAdmits(end, kind)));
}

/** The side of the directory a pane's filter admits at the far end. */
export function filterKinds(filter: EdgePaneFilter): readonly DirectoryEntityKind[] {
  if (filter === "people") return ["person"];
  if (filter === "organizations") return ["organization"];
  return EVERY_ENTITY_KIND;
}

/**
 * What the picker on a pane offers: both kinds until a type is chosen, then the type's far end,
 * always within what the pane itself lists.
 */
export function pickerKindsFor(
  record: DirectoryEntityKind,
  entry: EdgeTypeEntry | null,
  filter: EdgePaneFilter,
): readonly DirectoryEntityKind[] {
  const admitted = filterKinds(filter);
  if (entry === null) return admitted;
  return farKindsFor(record, entry).filter((kind) => admitted.includes(kind));
}

/** The types a pane offers for a new edge: everything the record may record, or the membership family. */
export function paneEdgeTypes(
  record: DirectoryEntityKind,
  filter: EdgePaneFilter,
): readonly EdgeTypeEntry[] {
  const offered = offeredEdgeTypesForRecord(record);
  if (filter === "all") return offered;
  return offered.filter((entry) => MEMBERSHIP_EDGE_TYPES.includes(entry.edgeType));
}

/** Whether a pane lists this edge: every edge, or the membership family with a far end of the pane's kind. */
export function paneShowsEdge(
  filter: EdgePaneFilter,
  edge: Pick<DirectoryEdgeEntry, "edgeType" | "farEntityKind">,
): boolean {
  if (filter === "all") return true;
  const membership = MEMBERSHIP_EDGE_TYPES.some((edgeType) => edgeType === edge.edgeType);
  return membership && filterKinds(filter).some((kind) => kind === edge.farEntityKind);
}

/** The pieces of an edge's sentence, so the far name can be rendered as a link inside it. */
export interface EdgeSentenceParts {
  before: string;
  far: string;
  after: string;
}

/**
 * The sentence in the type's own direction. `direction` is the record's end of the stored row:
 * "outbound" means the record is the origin and leads the sentence; "inbound" means the far entity
 * does. Either way the reading sits between origin and target and never turns round.
 */
export function edgeSentenceParts(
  recordName: string,
  entry: Pick<EdgeTypeEntry, "reading">,
  farName: string,
  direction: DirectoryEdgeEntry["direction"],
): EdgeSentenceParts {
  return direction === "outbound"
    ? { before: `${recordName} ${entry.reading} `, far: farName, after: "" }
    : { before: "", far: farName, after: ` ${entry.reading} ${recordName}` };
}

export function edgeSentence(
  recordName: string,
  entry: Pick<EdgeTypeEntry, "reading">,
  farName: string,
  direction: DirectoryEdgeEntry["direction"],
): string {
  const parts = edgeSentenceParts(recordName, entry, farName, direction);
  return `${parts.before}${parts.far}${parts.after}`;
}

/**
 * The reading for a stored type the catalog no longer describes. Every type recorded so far is in
 * the catalog; this is the honest sentence for one that arrives ahead of its entry.
 */
export const UNKNOWN_EDGE_READING = "is connected to";

/**
 * Why Add is refused, if it is. Undefined means the draft can be recorded. The control validates
 * before it enables: a press that would fail on the client is a press that should not be possible.
 */
export function edgeDraftRefusal(
  record: DirectoryEntityKind,
  draft: { picked: EdgePickedEnd | null; entry: EdgeTypeEntry | null },
): string | undefined {
  if (draft.picked === null) return "Choose who first.";
  if (draft.entry === null) return "Choose the relationship first.";
  if (!pickedKindFits(record, draft.picked.kind, draft.entry)) {
    const wanted = farKindsFor(record, draft.entry);
    const kindWord = wanted.length === 1 && wanted[0] === "person" ? "a person" : "an organization";
    return `${draft.entry.label} takes ${kindWord} at the other end.`;
  }
  return undefined;
}

/** What the far-end field is called, from what it may hold. */
export function farEndFieldName(kinds: readonly DirectoryEntityKind[]): string {
  if (kinds.length === 1 && kinds[0] === "person") return "Person";
  if (kinds.length === 1 && kinds[0] === "organization") return "Organization";
  return "Person or organization";
}
