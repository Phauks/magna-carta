import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { FileVersionId } from "@magna-carta/identifiers/types";
import type { MeetingRecordingState } from "./recording-types.ts";

/*
 * WHERE THE DOCUMENT A RECORDING BECAME STANDS, read from the file pipeline's own record of it.
 *
 * A recording that reaches `filed` has handed its audio to the file pipeline, and from that moment
 * the recording row stops being the authority on whether anybody can open it. The version it filed
 * is checked by the same scan as every upload: it is `pending` until the scan answers, `clean` once
 * it may be served, and `quarantined` when the scan holds it. A screen that offered the document on
 * the strength of the recording's `filed` would offer a version nobody may open yet, or one the scan
 * held, as if it were playable. So the answer is read from the version, never inferred from the row.
 *
 * THE VERSION THE RECORDING FILED, NOT THE FILE'S CURRENT ONE. The file is an ordinary document on
 * the matter: somebody may upload a later version over it, or move it to the trash. The file's own
 * download serves its CURRENT clean version, so the recording's document is `available` only while
 * that is exactly the version the recording filed; a later version is `replaced`, and the screen does
 * not open a different recording under this one's name.
 *
 * THE FILE'S MATTER IS GATED HERE TOO. The caller reached the recording through its meeting, whose
 * matter it may see; the file was filed on that matter, but a file can be moved. The visible-matter
 * predicate is composed against the file's own matter, as a required argument, so a document moved
 * behind a wall reads as `unavailable` rather than reporting its state across the wall.
 */

// Table names tracked against @magna-carta/database's per-firm schema; the file pipeline owns both.
const FILE_TABLE = "file";
const FILE_VERSION_TABLE = "file_version";

/**
 * What a recording's document is to somebody wanting to open it.
 *
 * - `pending` — the scan has not answered yet; it cannot be opened until it does.
 * - `available` — clean, on the matter, and the file's current version, so the file's download
 *   serves exactly what was recorded.
 * - `held` — the scan quarantined it, or a later scan flagged it.
 * - `replaced` — clean, but a later version of the file is now its current one.
 * - `removed` — the file was moved to the trash.
 * - `unavailable` — the upload never completed, or the file is not on a matter this reader may see.
 */
export const RECORDING_DOCUMENT_STATES = Object.freeze([
  "pending",
  "available",
  "held",
  "replaced",
  "removed",
  "unavailable",
] as const);
export type RecordingDocumentState = (typeof RECORDING_DOCUMENT_STATES)[number];

/** The document a recording filed: the version it filed, and where that version stands. */
export interface RecordingDocument {
  readonly versionId: FileVersionId;
  readonly state: RecordingDocumentState;
}

/** The facts about one filed version that decide its state, as the read returns them. */
export interface RecordingDocumentFacts {
  readonly version_id: FileVersionId;
  readonly version_status: "pending" | "clean" | "quarantined" | "abandoned";
  readonly scan_verdict: "unscanned" | "clean" | "flagged" | null;
  readonly current_version_id: FileVersionId | null;
  readonly deleted_at: string | null;
}

/** Where one filed version stands, from the facts the file pipeline holds about it. */
export function recordingDocumentStateOf(facts: RecordingDocumentFacts): RecordingDocumentState {
  if (facts.deleted_at !== null) return "removed";
  if (facts.version_status === "quarantined" || facts.scan_verdict === "flagged") return "held";
  if (facts.version_status === "pending") return "pending";
  if (facts.version_status === "abandoned") return "unavailable";
  return facts.current_version_id === facts.version_id ? "available" : "replaced";
}

/**
 * The facts for a page of filed versions at once: one read for the page, never one per row. A
 * version whose file is on a matter the reader may not see is absent from the answer.
 */
export async function readRecordingDocumentFacts(
  database: SqlDatabase,
  versionIds: readonly FileVersionId[],
  visibility: VisibleMatterPredicate,
): Promise<ReadonlyMap<FileVersionId, RecordingDocumentFacts>> {
  const unique = [...new Set(versionIds)];
  if (unique.length === 0) return new Map();
  const placeholders = unique.map(() => "?").join(", ");
  const { results } = await database
    .prepare(
      `SELECT ${FILE_VERSION_TABLE}.id AS version_id, ${FILE_VERSION_TABLE}.status AS version_status, ` +
        `${FILE_VERSION_TABLE}.scan_verdict AS scan_verdict, ` +
        `${FILE_TABLE}.current_version_id AS current_version_id, ${FILE_TABLE}.deleted_at AS deleted_at ` +
        `FROM ${FILE_VERSION_TABLE} JOIN ${FILE_TABLE} ON ${FILE_TABLE}.id = ${FILE_VERSION_TABLE}.file_id ` +
        `WHERE ${FILE_VERSION_TABLE}.id IN (${placeholders}) ` +
        `AND ${visibility.fragmentFor(`${FILE_TABLE}.matter_id`)}`,
    )
    .bind(...unique, ...visibility.bindings)
    .all<RecordingDocumentFacts>();
  return new Map(results.map((row) => [row.version_id, row]));
}

/** The part of a recording row that names what it filed. */
export interface RecordingFiledFacts {
  readonly state: MeetingRecordingState;
  readonly file_version_id: FileVersionId | null;
}

/**
 * The document one recording filed, or null where it filed none: only a `filed` recording that
 * names its version has one. A version the read did not return — its file is behind a wall, or the
 * row is gone — is `unavailable` rather than absent, because the recording still says it was filed
 * and the screen has to say why it cannot be opened.
 */
export function recordingDocumentFor(
  recording: RecordingFiledFacts,
  facts: ReadonlyMap<FileVersionId, RecordingDocumentFacts>,
): RecordingDocument | null {
  if (recording.state !== "filed" || recording.file_version_id === null) return null;
  const found = facts.get(recording.file_version_id);
  return {
    versionId: recording.file_version_id,
    state: found === undefined ? "unavailable" : recordingDocumentStateOf(found),
  };
}

/**
 * The documents for a page of recordings, keyed by recording row: the one read, then each row's
 * answer. The route calls this once per page.
 */
export async function readRecordingDocuments<Row extends RecordingFiledFacts>(
  database: SqlDatabase,
  recordings: readonly Row[],
  visibility: VisibleMatterPredicate,
): Promise<ReadonlyMap<Row, RecordingDocument | null>> {
  const versionIds = recordings.flatMap((recording) =>
    recording.state === "filed" && recording.file_version_id !== null
      ? [recording.file_version_id]
      : [],
  );
  const facts = await readRecordingDocumentFacts(database, versionIds, visibility);
  return new Map(
    recordings.map((recording) => [recording, recordingDocumentFor(recording, facts)]),
  );
}
