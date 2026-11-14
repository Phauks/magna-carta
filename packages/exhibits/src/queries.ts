import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type {
  ExhibitSetId,
  ExhibitSetMemberId,
  FileId,
  FileVersionId,
  MatterExhibitId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  EXHIBIT_COLUMNS,
  MATTER_EXHIBIT_TABLE,
  type MatterExhibitRow,
} from "./exhibit-statements.ts";
import { captionFor, labelFor } from "./label.ts";
import { EXHIBIT_SET_MEMBER_TABLE } from "./member-statements.ts";
import type { ExhibitScheme } from "./scheme.ts";
import { EXHIBIT_SET_TABLE, SET_COLUMNS, schemeOf, type ExhibitSetRow } from "./set-statements.ts";
import {
  MAX_CHAIN_DEPTH,
  type ExhibitDisposition,
  type ExhibitMemberStatus,
  type ExhibitSetState,
  type ExhibitSourceKind,
} from "./types.ts";
import { ExhibitValidationError } from "./validation.ts";

// The reads. Each is a fixed number of statements however many rows it returns: a set of two
// hundred members is read in one statement, not two hundred and one.

export interface ExhibitSetSummary {
  readonly id: ExhibitSetId;
  readonly matterId: MatterId;
  readonly name: string;
  readonly scheme: ExhibitScheme;
  readonly state: ExhibitSetState;
  readonly memberCount: number;
  readonly continuesFromSetId: ExhibitSetId | null;
  readonly supersedesSetId: ExhibitSetId | null;
  readonly supersededBySetId: ExhibitSetId | null;
  readonly disposition: ExhibitDisposition | null;
  readonly issuedOn: string | null;
  readonly issuedAt: string | null;
  readonly issuedBy: UserId | null;
  readonly filedCopyFileId: FileId | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ExhibitSetMemberView {
  readonly id: ExhibitSetMemberId;
  readonly exhibitId: MatterExhibitId;
  readonly position: number;
  /** "C" or "P-12": computed for a draft, read from the column for an issued set. */
  readonly label: string;
  /** "Exhibit C". */
  readonly caption: string;
  readonly referenceName: string;
  /** The exhibit's current title; for an issued member, the corrected or as-issued title. */
  readonly title: string;
  readonly description: string | null;
  readonly sourceKind: ExhibitSourceKind;
  readonly fileId: FileId;
  readonly fileName: string | null;
  readonly pinnedFileVersionId: FileVersionId | null;
  /** The version a draft would issue now, or the version an issued member went out with. */
  readonly fileVersionId: FileVersionId | null;
  readonly pageCount: number | null;
  readonly batesBegin: string | null;
  readonly batesEnd: string | null;
  readonly status: ExhibitMemberStatus;
  readonly withdrawnAt: string | null;
  readonly withdrawalBasis: string | null;
  readonly titleAsIssued: string | null;
  readonly fileVersionIdAsIssued: FileVersionId | null;
  readonly correctedAt: string | null;
  readonly correctionBasis: string | null;
}

export interface ExhibitSetView extends ExhibitSetSummary {
  readonly members: readonly ExhibitSetMemberView[];
}

function summaryOf(
  set: ExhibitSetRow,
  memberCount: number,
  supersededBySetId: ExhibitSetId | null,
): ExhibitSetSummary {
  return {
    id: set.id,
    matterId: set.matter_id,
    name: set.name,
    scheme: schemeOf(set),
    state: set.state,
    memberCount,
    continuesFromSetId: set.continues_from_set_id,
    supersedesSetId: set.supersedes_set_id,
    supersededBySetId,
    disposition: set.disposition,
    issuedOn: set.issued_on,
    issuedAt: set.issued_at,
    issuedBy: set.issued_by,
    filedCopyFileId: set.filed_copy_file_id,
    createdAt: set.created_at,
    updatedAt: set.updated_at,
  };
}

interface MemberJoinRow {
  readonly set_json: string;
  readonly member_id: ExhibitSetMemberId | null;
  readonly position: number | null;
  readonly label: string | null;
  readonly title_as_issued: string | null;
  readonly file_version_id_as_issued: FileVersionId | null;
  readonly status: ExhibitMemberStatus | null;
  readonly withdrawn_at: string | null;
  readonly withdrawal_basis: string | null;
  readonly corrected_title: string | null;
  readonly corrected_file_version_id: FileVersionId | null;
  readonly corrected_at: string | null;
  readonly correction_basis: string | null;
  readonly exhibit_id: MatterExhibitId | null;
  readonly reference_name: string | null;
  readonly title: string | null;
  readonly description: string | null;
  readonly source_kind: ExhibitSourceKind | null;
  readonly file_id: FileId | null;
  readonly pinned_file_version_id: FileVersionId | null;
  readonly page_count: number | null;
  readonly bates_begin: string | null;
  readonly bates_end: string | null;
  readonly file_name: string | null;
  readonly current_version_id: FileVersionId | null;
  readonly superseded_by: ExhibitSetId | null;
}

const SET_JSON = `json_object(${SET_COLUMNS.split(", ")
  .map((column) => `'${column}', s.${column}`)
  .join(", ")})`;

/**
 * One set and its members, in position order, with every label. ONE statement: the set, its
 * members, their exhibits, their files and the set's successor come back joined.
 */
export async function readExhibitSet(
  database: SqlDatabase,
  matterId: MatterId,
  setId: ExhibitSetId,
): Promise<ExhibitSetView | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${SET_JSON} AS set_json, m.id AS member_id, m.position, m.label, m.title_as_issued, ` +
        `m.file_version_id_as_issued, m.status, m.withdrawn_at, m.withdrawal_basis, ` +
        `m.corrected_title, m.corrected_file_version_id, m.corrected_at, m.correction_basis, ` +
        `e.id AS exhibit_id, e.reference_name, e.title, e.description, e.source_kind, e.file_id, ` +
        `e.pinned_file_version_id, e.page_count, e.bates_begin, e.bates_end, f.name AS file_name, ` +
        `f.current_version_id, ` +
        `(SELECT n.id FROM ${EXHIBIT_SET_TABLE} n WHERE n.supersedes_set_id = s.id) AS superseded_by ` +
        `FROM ${EXHIBIT_SET_TABLE} s ` +
        `LEFT JOIN ${EXHIBIT_SET_MEMBER_TABLE} m ON m.exhibit_set_id = s.id ` +
        `LEFT JOIN ${MATTER_EXHIBIT_TABLE} e ON e.id = m.matter_exhibit_id ` +
        `LEFT JOIN file f ON f.id = e.file_id ` +
        `WHERE s.id = ?1 AND s.matter_id = ?2 ORDER BY m.position`,
    )
    .bind(setId, matterId)
    .all<MemberJoinRow>();
  const first = results[0];
  if (first === undefined) return undefined;
  const set = JSON.parse(first.set_json) as ExhibitSetRow;
  const scheme = schemeOf(set);
  const issued = set.state === "issued";
  const members: ExhibitSetMemberView[] = [];
  for (const row of results) {
    if (row.member_id === null || row.exhibit_id === null || row.position === null) continue;
    // A draft's label is computed and its column is never consulted; an issued set's column is the
    // authority and the function is not consulted.
    const label = issued ? (row.label ?? "") : labelFor(row.position, scheme);
    members.push({
      id: row.member_id,
      exhibitId: row.exhibit_id,
      position: row.position,
      label,
      caption: captionFor(label, scheme),
      referenceName: row.reference_name ?? "",
      title: issued
        ? (row.corrected_title ?? row.title_as_issued ?? row.title ?? "")
        : (row.title ?? ""),
      description: row.description,
      sourceKind: row.source_kind ?? "matterFile",
      fileId: row.file_id as FileId,
      fileName: row.file_name,
      pinnedFileVersionId: row.pinned_file_version_id,
      fileVersionId: issued
        ? (row.corrected_file_version_id ?? row.file_version_id_as_issued)
        : (row.pinned_file_version_id ?? row.current_version_id),
      pageCount: row.page_count,
      batesBegin: row.bates_begin,
      batesEnd: row.bates_end,
      status: row.status ?? "active",
      withdrawnAt: row.withdrawn_at,
      withdrawalBasis: row.withdrawal_basis,
      titleAsIssued: row.title_as_issued,
      fileVersionIdAsIssued: row.file_version_id_as_issued,
      correctedAt: row.corrected_at,
      correctionBasis: row.correction_basis,
    });
  }
  return { ...summaryOf(set, members.length, first.superseded_by), members };
}

/** Every set on a matter, newest first, with member counts. One statement. */
export async function listExhibitSets(
  database: SqlDatabase,
  matterId: MatterId,
  options: { readonly includeArchived?: boolean } = {},
): Promise<ExhibitSetSummary[]> {
  const { results } = await database
    .prepare(
      `SELECT ${SET_JSON} AS set_json, ` +
        `(SELECT COUNT(*) FROM ${EXHIBIT_SET_MEMBER_TABLE} m WHERE m.exhibit_set_id = s.id) AS member_count, ` +
        `(SELECT n.id FROM ${EXHIBIT_SET_TABLE} n WHERE n.supersedes_set_id = s.id) AS superseded_by ` +
        `FROM ${EXHIBIT_SET_TABLE} s WHERE s.matter_id = ?1 ` +
        (options.includeArchived === true ? "" : "AND s.archived_at IS NULL ") +
        `ORDER BY s.created_at DESC, s.id DESC`,
    )
    .bind(matterId)
    .all<{ set_json: string; member_count: number; superseded_by: ExhibitSetId | null }>();
  return results.map((row) =>
    summaryOf(JSON.parse(row.set_json) as ExhibitSetRow, row.member_count, row.superseded_by),
  );
}

export interface ExhibitAppearance {
  readonly setId: ExhibitSetId;
  readonly setName: string;
  readonly state: ExhibitSetState;
  readonly label: string;
  readonly status: ExhibitMemberStatus;
}

export interface MatterExhibitView {
  readonly id: MatterExhibitId;
  readonly referenceName: string;
  readonly title: string;
  readonly description: string | null;
  readonly sourceKind: ExhibitSourceKind;
  readonly fileId: FileId;
  readonly fileName: string | null;
  readonly pinnedFileVersionId: FileVersionId | null;
  readonly pageCount: number | null;
  readonly batesBegin: string | null;
  readonly batesEnd: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  /** Every set this exhibit is in, with the label it carries there. */
  readonly appearances: readonly ExhibitAppearance[];
}

interface RegisterRow extends MatterExhibitRow {
  readonly file_name: string | null;
  readonly appearances_json: string;
}

/**
 * The matter's exhibit register: every exhibit, and which sets it appears in with its label in
 * each. One statement; a draft label is computed here from the set's scheme like every other read.
 */
export async function listMatterExhibits(
  database: SqlDatabase,
  matterId: MatterId,
  options: { readonly includeArchived?: boolean } = {},
): Promise<MatterExhibitView[]> {
  const columns = EXHIBIT_COLUMNS.split(", ")
    .map((column) => `e.${column}`)
    .join(", ");
  const { results } = await database
    .prepare(
      `SELECT ${columns}, f.name AS file_name, ` +
        `(SELECT json_group_array(json_object('setId', s.id, 'setName', s.name, 'state', s.state, ` +
        `'position', m.position, 'label', m.label, 'status', m.status, 'noun', s.noun, ` +
        `'prefix', s.prefix, 'sequence', s.sequence, 'startAt', s.start_at, ` +
        `'overflowForm', s.overflow_form)) FROM ${EXHIBIT_SET_MEMBER_TABLE} m ` +
        `JOIN ${EXHIBIT_SET_TABLE} s ON s.id = m.exhibit_set_id ` +
        `WHERE m.matter_exhibit_id = e.id AND s.archived_at IS NULL) AS appearances_json ` +
        `FROM ${MATTER_EXHIBIT_TABLE} e LEFT JOIN file f ON f.id = e.file_id ` +
        `WHERE e.matter_id = ?1 ` +
        (options.includeArchived === true ? "" : "AND e.archived_at IS NULL ") +
        `ORDER BY e.created_at, e.id`,
    )
    .bind(matterId)
    .all<RegisterRow>();
  return results.map((row) => {
    const raw = JSON.parse(row.appearances_json) as {
      setId: ExhibitSetId;
      setName: string;
      state: ExhibitSetState;
      position: number;
      label: string | null;
      status: ExhibitMemberStatus;
      noun: string;
      prefix: string;
      sequence: ExhibitScheme["sequence"];
      startAt: number;
      overflowForm: ExhibitScheme["overflowForm"];
    }[];
    return {
      id: row.id,
      referenceName: row.reference_name,
      title: row.title,
      description: row.description,
      sourceKind: row.source_kind,
      fileId: row.file_id,
      fileName: row.file_name,
      pinnedFileVersionId: row.pinned_file_version_id,
      pageCount: row.page_count,
      batesBegin: row.bates_begin,
      batesEnd: row.bates_end,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at,
      appearances: raw.map((appearance) => ({
        setId: appearance.setId,
        setName: appearance.setName,
        state: appearance.state,
        label:
          appearance.state === "issued"
            ? (appearance.label ?? "")
            : labelFor(appearance.position, appearance),
        status: appearance.status,
      })),
    };
  });
}

/**
 * The chain of sets a set continues from, nearest first. ONE recursive statement, capped: a chain
 * longer than the cap is REFUSED, never truncated, because a continuing set's first label depends
 * on every set before it.
 */
export async function readContinuationChain(
  database: SqlDatabase,
  setId: ExhibitSetId,
): Promise<ExhibitSetRow[]> {
  const columns = SET_COLUMNS.split(", ")
    .map((column) => `s.${column}`)
    .join(", ");
  const { results } = await database
    .prepare(
      `WITH RECURSIVE chain(id, depth) AS (` +
        `SELECT continues_from_set_id, 1 FROM ${EXHIBIT_SET_TABLE} WHERE id = ?1 ` +
        `AND continues_from_set_id IS NOT NULL ` +
        `UNION ALL SELECT p.continues_from_set_id, chain.depth + 1 FROM chain ` +
        `JOIN ${EXHIBIT_SET_TABLE} p ON p.id = chain.id ` +
        `WHERE p.continues_from_set_id IS NOT NULL AND chain.depth <= ?2) ` +
        `SELECT ${columns}, chain.depth AS depth FROM chain ` +
        `JOIN ${EXHIBIT_SET_TABLE} s ON s.id = chain.id ORDER BY chain.depth`,
    )
    .bind(setId, MAX_CHAIN_DEPTH)
    .all<ExhibitSetRow & { depth: number }>();
  if (results.length > MAX_CHAIN_DEPTH) {
    throw new ExhibitValidationError(
      "exhibit-chain-too-deep",
      `a continuation chain is followed through at most ${MAX_CHAIN_DEPTH} sets`,
    );
  }
  return results.map(({ depth: _depth, ...set }) => set);
}
