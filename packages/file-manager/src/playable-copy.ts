import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { FileId, FileVersionId, MatterId } from "@magna-carta/identifiers/types";
import { FILE_TABLE, FILE_VERSION_TABLE } from "./file-statements.ts";

// A copy of a video version that every browser plays.
//
// The inline-playable verdict (inline-playable.ts) promises only that SOME current browser decodes a
// recording: an HEVC phone video plays in Safari and Chrome but not in Firefox, a Matroska file plays
// in Chrome but not in Safari, and a 10-bit or 4:2:2 picture plays almost nowhere. When the browser
// in front of a member cannot play the original, the member can ask for a copy that every browser
// plays: H.264 pictures and AAC sound in a faststart MP4, made by the Rust transcode engine
// (containers/transcode) off the request path. The five `playable_copy_*` columns on `file_version`
// record that copy; this module is the one home for what they mean, the key the copy lives at, and
// which versions the engine can take at all.
//
// The copy is made from one version and belongs to it. A new version of the file is a new recording
// and gets its own copy only when somebody asks; the old copy stays with the old version and goes
// wherever that version's bytes go (file-service.ts, the purge point).

/** Where a version's playable copy stands. Null on the row means nobody has asked for one. */
export type PlayableCopyState = "pending" | "ready" | "unavailable";

/**
 * Why a copy cannot be made, as the engine answers it. `unsupported`: the original holds a codec or
 * container the engine does not decode (WMV, ProRes, AC-3 sound, a fragmented MP4). `malformed`: the
 * file is damaged or is not what its type says. `too-large`: past the engine's ceilings (two
 * gibibytes, six hours, an 8K picture). `source-missing`: the original's object is gone.
 */
export type PlayableCopyUnavailableReason =
  | "unsupported"
  | "malformed"
  | "too-large"
  | "source-missing";

/** The container the engine is told the original is in, by the format id it registers. */
export type PlayableCopySourceFormat = "mp4" | "mov" | "mkv";

/**
 * The engine reads MP4, QuickTime and Matroska. WebM is Matroska too, but it only ever carries VP8,
 * VP9 or AV1 pictures, none of which the engine decodes, and every browser that plays WebM at all
 * plays those already — so a WebM file is never a candidate rather than a guaranteed refusal.
 */
export function playableCopySourceFormat(
  sniffedContentType: string | null,
): PlayableCopySourceFormat | null {
  switch (sniffedContentType) {
    case "video/mp4":
    case "video/x-m4v":
      return "mp4";
    case "video/quicktime":
      return "mov";
    case "video/x-matroska":
      return "mkv";
    default:
      return null;
  }
}

// Beside the version's own object, with a suffix rather than a nested segment: a file's objects are
// listed by its key prefix when the file is purged, and the copy must fall inside that listing.
// Derived from the version's own key (not rebuilt from its ids) so a bulk-lane version's copy sits
// under the bulk prefix beside it.
export function playableCopyKey(versionR2Key: string): string {
  return `${versionR2Key}.playable.mp4`;
}

/**
 * How long a request may stay `pending` before another request is allowed to ask again. The engine
 * runs inside a queue consumer, whose invocation is cut off after fifteen minutes, and the queue
 * retries a failed conversion three times; a request still pending well past that died on the way
 * (a dead-lettered message, a deploy in between) and asking again is the only way out of it.
 */
export const PLAYABLE_COPY_STALE_AFTER_MILLISECONDS = 90 * 60 * 1000;

export interface PlayableCopyFacts {
  readonly playableCopyState: PlayableCopyState | null;
  readonly playableCopyR2Key: string | null;
  readonly playableCopySizeBytes: number | null;
  readonly playableCopyReason: PlayableCopyUnavailableReason | null;
  readonly playableCopyRequestedAt: string | null;
}

export interface VersionForPlayableCopy extends PlayableCopyFacts {
  readonly id: FileVersionId;
  readonly fileId: FileId;
  readonly matterId: MatterId;
  readonly r2Key: string;
  readonly sizeBytes: number | null;
  readonly sniffedContentType: string | null;
  readonly storageEncoding: string;
  // A re-scan can flag an already-committed version; a flagged recording is never converted, so a
  // copy never becomes a way round the gate that keeps it out of the player.
  readonly scanVerdict: "unscanned" | "clean" | "flagged" | null;
}

/** What a request for a copy should do, decided from the version's row alone. */
export type PlayableCopyRequestDecision =
  // Already made: hand it out.
  | { readonly kind: "ready" }
  // Already refused by the engine: asking again would get the same answer.
  | { readonly kind: "unavailable"; readonly reason: PlayableCopyUnavailableReason }
  // A conversion is under way and not yet overdue: wait for it.
  | { readonly kind: "in-progress" }
  // Nobody has asked, or the last request died: mark it pending and send the work.
  | { readonly kind: "start"; readonly sourceFormat: PlayableCopySourceFormat }
  // The engine cannot take this version at all.
  | { readonly kind: "not-a-candidate"; readonly why: "not-a-video" | "encoded" | "flagged" };

export function decidePlayableCopyRequest(
  version: VersionForPlayableCopy,
  nowMilliseconds: number,
): PlayableCopyRequestDecision {
  if (version.scanVerdict === "flagged") return { kind: "not-a-candidate", why: "flagged" };
  if (version.playableCopyState === "ready" && version.playableCopyR2Key !== null) {
    return { kind: "ready" };
  }
  if (version.playableCopyState === "unavailable") {
    return { kind: "unavailable", reason: version.playableCopyReason ?? "unsupported" };
  }
  const sourceFormat = playableCopySourceFormat(version.sniffedContentType);
  if (sourceFormat === null) return { kind: "not-a-candidate", why: "not-a-video" };
  // A delta-encoded object is not the recording's bytes, and the engine reads the object as stored.
  if (version.storageEncoding !== "full") return { kind: "not-a-candidate", why: "encoded" };
  if (version.playableCopyState === "pending" && version.playableCopyRequestedAt !== null) {
    const requestedAt = Date.parse(version.playableCopyRequestedAt);
    if (
      !Number.isNaN(requestedAt) &&
      nowMilliseconds - requestedAt < PLAYABLE_COPY_STALE_AFTER_MILLISECONDS
    ) {
      return { kind: "in-progress" };
    }
  }
  return { kind: "start", sourceFormat };
}

/** Marks a version as owing a copy, stamped with when it was asked for. */
export function markVersionPlayableCopyPendingStatement(
  database: SqlDatabase,
  versionId: FileVersionId,
  requestedAt: string,
): SqlStatement {
  return database
    .prepare(
      // fitness:allow-no-status — the requesting route read this version as clean a moment ago and addresses it by id
      `UPDATE ${FILE_VERSION_TABLE} SET playable_copy_state = 'pending', playable_copy_r2_key = NULL, playable_copy_size_bytes = NULL, playable_copy_reason = NULL, playable_copy_requested_at = ?2 WHERE id = ?1`,
    )
    .bind(versionId, requestedAt);
}

export type RecordPlayableCopyRow =
  | {
      readonly versionId: FileVersionId;
      readonly state: "ready";
      readonly r2Key: string;
      readonly sizeBytes: number;
    }
  | {
      readonly versionId: FileVersionId;
      readonly state: "unavailable";
      readonly reason: PlayableCopyUnavailableReason;
    };

/** Records the produced copy, or why none can be made. Addressed by id: the row is the one asked about. */
export function recordVersionPlayableCopyStatement(
  database: SqlDatabase,
  row: RecordPlayableCopyRow,
): SqlStatement {
  return database
    .prepare(
      // fitness:allow-no-status — the copy's row is addressed by id, whatever its status has become
      `UPDATE ${FILE_VERSION_TABLE} SET playable_copy_state = ?2, playable_copy_r2_key = ?3, playable_copy_size_bytes = ?4, playable_copy_reason = ?5 WHERE id = ?1`,
    )
    .bind(
      row.versionId,
      row.state,
      row.state === "ready" ? row.r2Key : null,
      row.state === "ready" ? row.sizeBytes : null,
      row.state === "unavailable" ? row.reason : null,
    );
}

const VERSION_COLUMNS =
  `v.id, v.file_id, f.matter_id, v.r2_key, v.size_bytes, v.sniffed_content_type, v.storage_encoding, v.scan_verdict, ` +
  `v.playable_copy_state, v.playable_copy_r2_key, v.playable_copy_size_bytes, v.playable_copy_reason, ` +
  `v.playable_copy_requested_at`;

// One version by id, filtered to `clean`: a withdrawn or quarantined version is not served and gets
// no copy. The producer reads this; it does not care whether the version is still the current one,
// since a member who asked about an older version in history is owed that version's copy.
export function selectVersionForPlayableCopyStatement(
  database: SqlDatabase,
  versionId: FileVersionId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${VERSION_COLUMNS} FROM ${FILE_VERSION_TABLE} v JOIN ${FILE_TABLE} f ON f.id = v.file_id ` +
        `WHERE v.id = ?1 AND v.status = 'clean'`,
    )
    .bind(versionId);
}

// A file's current clean version, the one the player shows: what the request and status routes read.
// A deleted file has none, so its copy can be neither asked for nor looked up.
export function selectCurrentVersionForPlayableCopyStatement(
  database: SqlDatabase,
  fileId: FileId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${VERSION_COLUMNS} FROM ${FILE_TABLE} f JOIN ${FILE_VERSION_TABLE} v ON v.id = f.current_version_id ` +
        `WHERE f.id = ?1 AND f.deleted_at IS NULL AND v.status = 'clean'`,
    )
    .bind(fileId);
}

interface VersionRow {
  id: FileVersionId;
  file_id: FileId;
  matter_id: MatterId;
  r2_key: string;
  size_bytes: number | null;
  sniffed_content_type: string | null;
  storage_encoding: string;
  scan_verdict: "unscanned" | "clean" | "flagged" | null;
  playable_copy_state: PlayableCopyState | null;
  playable_copy_r2_key: string | null;
  playable_copy_size_bytes: number | null;
  playable_copy_reason: PlayableCopyUnavailableReason | null;
  playable_copy_requested_at: string | null;
}

async function firstVersion(statement: SqlStatement): Promise<VersionForPlayableCopy | undefined> {
  const { results } = await statement.all<VersionRow>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    id: row.id,
    fileId: row.file_id,
    matterId: row.matter_id,
    r2Key: row.r2_key,
    sizeBytes: row.size_bytes,
    sniffedContentType: row.sniffed_content_type,
    storageEncoding: row.storage_encoding,
    scanVerdict: row.scan_verdict,
    playableCopyState: row.playable_copy_state,
    playableCopyR2Key: row.playable_copy_r2_key,
    playableCopySizeBytes: row.playable_copy_size_bytes,
    playableCopyReason: row.playable_copy_reason,
    playableCopyRequestedAt: row.playable_copy_requested_at,
  };
}

export function readVersionForPlayableCopy(
  database: SqlDatabase,
  versionId: FileVersionId,
): Promise<VersionForPlayableCopy | undefined> {
  return firstVersion(selectVersionForPlayableCopyStatement(database, versionId));
}

export function readCurrentVersionForPlayableCopy(
  database: SqlDatabase,
  fileId: FileId,
): Promise<VersionForPlayableCopy | undefined> {
  return firstVersion(selectCurrentVersionForPlayableCopyStatement(database, fileId));
}
