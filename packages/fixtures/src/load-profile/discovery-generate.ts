import type { DatabaseSync } from "node:sqlite";

// THE DISCOVERY VOLUME, and why it is its own profile rather than a section of the shared one.
//
// Every other domain in the load profile is sized like an established firm's own book, and they all
// ride one snapshot so their baselines are comparable. A review set is not sized like that: it is
// filled by an OUTSIDE PARTY, one small production is ten thousand documents, and at the ceiling the
// review-document table is the largest in the firm's database by an order of magnitude. Folding that
// into the shared generator would change the identity of every other domain's baseline for a table
// none of them read, and it would put a quarter-million-row seed in front of every measurement run.
//
// It also needs something the shared profile structurally cannot express: TWO volumes. The question
// the per-review-set ceiling turns on is what the database looks like at 250,000 documents, and the
// answer has to be measured at the standard volume and again at the ceiling, from the same generator
// with the same shape, so the two are comparable.
//
// SEEDED WITH DIRECT INSERTS rather than through the domain write paths, which is the opposite of the
// rule the shared generator follows and is deliberate here for two reasons. The corpus this produces
// is not a corpus a firm could produce — the load lanes refuse a version that does not exist and the
// processing lane refuses to mark a document processed without an engine having read it — so riding
// the real paths would mean standing up an engine to seed a measurement. And at the ceiling volume it
// is a quarter of a million commits through the effect batch, which is a measurement of the seeder.
// What the shapes here MUST match is the schema and the reads, and the schema enforces that itself:
// every CHECK and every foreign key is live, so a seed that drifted from what the pipeline writes
// fails to insert rather than quietly measuring the wrong rows.

// Every count is a parameter. Changing one changes what the baselines below describe, so the profile
// carries a version the measurement output prints beside its numbers.
export interface DiscoveryVolumeProfile {
  readonly name: string;
  // Bump on ANY parameter change: two runs over differently-shaped corpora must never be compared as
  // though they measured the same thing.
  readonly version: number;
  readonly reviewDocumentCount: number;
  // A production of any size is not one custodian's mailbox. This is what makes the Custodian of
  // Record filter a filter rather than a no-op.
  readonly recordCustodianCount: number;
  // Loads the corpus arrived on. More than one, because the load filter is one of the five and a
  // single-load corpus would measure it selecting everything.
  readonly loadCount: number;
  // One document in this many is unreadable — locked spreadsheets, files damaged in transfer,
  // photographs of whiteboards. The rate decides whether the exception reads walk a handful of rows
  // or a meaningful slice of the corpus.
  readonly exceptionInEvery: number;
  // And one in this many is parked: what a review set looks like while an engine is undeployed.
  readonly parkedInEvery: number;
  // One in this many has no derivable date. This is the parameter the list page's two-segment walk
  // exists for, and a profile that set it to zero would prove the undated tail works by never
  // producing one.
  readonly undatedInEvery: number;
  // One in this many is a suppressed duplicate carrying an occurrence row.
  readonly duplicateInEvery: number;
  // The family size for the documents that are in one: an email and its attachments.
  readonly familySize: number;
  // One in this many families is a family rather than a standalone document.
  readonly familyInEvery: number;
  // How many documents a dispatch turn and a list page each ask for.
  readonly dispatchPageSize: number;
  readonly listPageSize: number;
}

// The volume the design's own arithmetic is stated at, and the one every baseline is taken from.
export const STANDARD_DISCOVERY_VOLUME: DiscoveryVolumeProfile = {
  name: "discoveryVolume",
  version: 1,
  reviewDocumentCount: 25_000,
  recordCustodianCount: 5,
  loadCount: 3,
  exceptionInEvery: 40,
  parkedInEvery: 25,
  undatedInEvery: 12,
  duplicateInEvery: 30,
  familySize: 4,
  familyInEvery: 6,
  dispatchPageSize: 100,
  listPageSize: 100,
};

// The ceiling, which is the number the whole per-review-set bound is argued from. Running it is a
// deliberate act — it seeds a quarter of a million documents — so the measurement suite runs the
// standard volume by default and this one when asked.
export const LARGE_DISCOVERY_VOLUME: DiscoveryVolumeProfile = {
  ...STANDARD_DISCOVERY_VOLUME,
  name: "discoveryVolumeLarge",
  reviewDocumentCount: 250_000,
  // A production at the ceiling is not one department's files either.
  recordCustodianCount: 40,
  loadCount: 12,
};

export const DISCOVERY_VOLUMES: Readonly<Record<"standard" | "large", DiscoveryVolumeProfile>> = {
  standard: STANDARD_DISCOVERY_VOLUME,
  large: LARGE_DISCOVERY_VOLUME,
};

// Deterministic identifiers. The corpus has to be reproducible so a plan probe binds the same row the
// measurement ran against, and a seeded generator would be a second source of randomness in a package
// whose whole determinism story is one seed.
const INSTANT = "2026-08-19T00:00:00.000Z";
export const DISCOVERY_MATTER_ID = "matter_loadProfile0000000000";
export const DISCOVERY_REVIEW_SET_ID = "reviewSet_loadProfile00000000000";
export const DISCOVERY_MEMBER_ID = "user_loadProfile000000000000";

function pad(value: number): string {
  return String(value).padStart(8, "0");
}

// A DISTINCT instant per document, and the distinctness is the point rather than the realism. A
// corpus whose documents shared a handful of dates would make the list page's tie-break branch —
// `sort_date = ? AND id < ?` — cover twenty thousand rows, and the measurement would be of the
// generator's date cardinality rather than of the read. Real documents carry their own timestamps;
// this spreads them one minute apart across a plausible span, oldest first.
function documentDate(ordinal: number): string {
  return new Date(Date.UTC(2024, 0, 1) + ordinal * 60_000).toISOString();
}

export function discoveryLoadId(ordinal: number): string {
  return `discoveryLoad_lp${pad(ordinal)}00000`;
}

export function recordCustodianId(ordinal: number): string {
  return `recordCustodian_lp${pad(ordinal)}00000`;
}

export function reviewDocumentId(ordinal: number): string {
  return `reviewDocument_lp${pad(ordinal)}0000`;
}

// The probes the measurement layer binds real queries to. Recorded rather than re-derived, so a plan
// probe and the measurement it explains are provably about the same row.
export interface DiscoveryProbes {
  readonly reviewSetId: string;
  readonly matterId: string;
  readonly memberUserId: string;
  // The load the dispatch walk resumes inside, and the cursor it resumes from — taken well past the
  // head, because the first page of a keyset walk is the one page it is cheapest on.
  readonly busiestLoadId: string;
  readonly midWalkCursorId: string;
  // The (sort_date, id) pair that opens a list page deep in the DATED segment, and the id that opens
  // one inside the UNDATED tail. The two are separate statements over the same index, so both have to
  // be measured where a real walk spends its time.
  readonly midListCursorSortDate: string;
  readonly midListCursorId: string;
  readonly undatedCursorId: string;
  // A Custodian of Record holding a real slice of the corpus, and a family with members in it.
  readonly filterRecordCustodianId: string;
  readonly filterFamilyId: string;
  // A document that is the primary of a duplicate group with occurrences hanging off it.
  readonly dedupPrimaryId: string;
  // Documents still `pending` and unparked, which the measured write pair can claim one at a time.
  readonly writableIds: readonly string[];
  // What was actually laid down, so the measurement output can state the shape it measured.
  readonly reviewDocumentCount: number;
  readonly exceptionCount: number;
  readonly occurrenceCount: number;
}

// The whole corpus, in one transaction. Foreign keys are OFF for the seed and only for the seed: the
// rows reference File Manager files and versions that this generator also writes, and the insert
// order inside one statement-per-row loop would otherwise have to interleave three tables to satisfy
// them row by row. Every CHECK stays live, which is the constraint that actually matters here — a
// seeded row that could not be written by the pipeline fails loudly rather than being measured.
export function seedDiscoveryVolume(
  raw: DatabaseSync,
  profile: DiscoveryVolumeProfile,
): DiscoveryProbes {
  raw.exec("PRAGMA foreign_keys = OFF");
  raw
    .prepare(
      "INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at) VALUES (?, 'LP', 'active', 0, ?)",
    )
    .run(DISCOVERY_MEMBER_ID, INSTANT);
  raw
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at) VALUES (?, 'M', 'open', ?, 0, ?, ?)",
    )
    .run(DISCOVERY_MATTER_ID, DISCOVERY_MEMBER_ID, INSTANT, INSTANT);
  raw
    .prepare(
      `INSERT INTO review_set (id, matter_id, name, state, document_ceiling, document_count,
         semantic_index_enabled, created_by, created_at, updated_at)
       VALUES (?, ?, 'Plaintiff production', 'open', 250000, ?, 0, ?, ?, ?)`,
    )
    .run(
      DISCOVERY_REVIEW_SET_ID,
      DISCOVERY_MATTER_ID,
      profile.reviewDocumentCount,
      DISCOVERY_MEMBER_ID,
      INSTANT,
      INSTANT,
    );
  // The access list is part of the volume, not scaffolding around it: every member-facing read
  // composes an EXISTS against it, so a corpus seeded without one would measure a predicate that
  // matches nothing.
  raw
    .prepare(
      "INSERT INTO review_set_access (id, review_set_id, member_user_id, granted_by, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      "reviewSetAccess_lp0000000000000000",
      DISCOVERY_REVIEW_SET_ID,
      DISCOVERY_MEMBER_ID,
      DISCOVERY_MEMBER_ID,
      INSTANT,
    );

  const insertCustodian = raw.prepare(
    "INSERT INTO record_custodian (id, review_set_id, display_name, kind, created_at, updated_at) VALUES (?, ?, ?, 'person', ?, ?)",
  );
  for (let index = 0; index < profile.recordCustodianCount; index += 1) {
    insertCustodian.run(
      recordCustodianId(index),
      DISCOVERY_REVIEW_SET_ID,
      `Custodian ${index}`,
      INSTANT,
      INSTANT,
    );
  }

  const insertLoad = raw.prepare(
    `INSERT INTO discovery_load (id, review_set_id, lane, state, transcript_scope,
       declared_document_count, loaded_document_count, processed_count, exception_count,
       initiated_by, initiated_at, created_at, updated_at)
     VALUES (?, ?, 'received-production', 'processing', 'exclude', ?, ?, 0, 0, ?, ?, ?, ?)`,
  );
  // The first load carries the bulk of the corpus: a real production arrives as one large load and a
  // few small supplements, and the dispatch walk's cost is set by the large one.
  const documentsInFirstLoad =
    profile.reviewDocumentCount -
    (profile.loadCount - 1) * Math.floor(profile.reviewDocumentCount / (profile.loadCount * 4));
  const documentsInLaterLoad = Math.floor(profile.reviewDocumentCount / (profile.loadCount * 4));
  for (let index = 0; index < profile.loadCount; index += 1) {
    const count = index === 0 ? documentsInFirstLoad : documentsInLaterLoad;
    insertLoad.run(
      discoveryLoadId(index),
      DISCOVERY_REVIEW_SET_ID,
      count,
      count,
      DISCOVERY_MEMBER_ID,
      INSTANT,
      INSTANT,
      INSTANT,
    );
  }

  const insertFile = raw.prepare(
    "INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  );
  const insertVersion = raw.prepare(
    "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, sniffed_content_type, status, scan_verdict, created_at) VALUES (?, ?, 1, ?, 40960, 'application/pdf', 'clean', 'clean', ?)",
  );
  const insertDocument = raw.prepare(
    `INSERT INTO review_document (id, review_set_id, discovery_load_id, record_custodian_id,
       source_kind, file_version_id, family_id, family_role, family_sequence, source_name,
       size_bytes, content_sha256, dedup_group_id, is_dedup_primary, processing_state,
       processing_deferred_reason, index_state, format_identified, extraction_route,
       pages_recognized, page_count, sort_date, sort_date_source, text_r2_key, metadata_r2_key,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, 'file_version', ?, ?, ?, ?, ?, 40960, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       ?, ?, ?, ?)`,
  );
  const insertException = raw.prepare(
    "INSERT INTO review_document_exception (id, review_set_id, discovery_load_id, review_document_id, stage, code, detail, created_at) VALUES (?, ?, ?, ?, 'extract', ?, NULL, ?)",
  );
  const insertOccurrence = raw.prepare(
    "INSERT INTO review_document_occurrence (id, review_set_id, primary_review_document_id, duplicate_review_document_id, record_custodian_id, discovery_load_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  // The codes a real production actually produces, in roughly the proportions it produces them.
  const codes = ["encrypted", "password-protected", "corrupt", "no-text-extracted", "oversize"];

  const writableIds: string[] = [];
  let midWalkCursorId = "";
  let midListCursorSortDate = "";
  let midListCursorId = "";
  let undatedCursorId = "";
  let filterFamilyId = "";
  let dedupPrimaryId = "";
  let exceptionCount = 0;
  let occurrenceCount = 0;
  let lastPrimaryId = "";

  raw.exec("BEGIN");
  for (let index = 0; index < profile.reviewDocumentCount; index += 1) {
    const suffix = pad(index);
    const documentId = reviewDocumentId(index);
    const fileId = `file_lp${suffix}`;
    const versionId = `fileVersion_lp${suffix}`;
    insertFile.run(fileId, DISCOVERY_MATTER_ID, `PLTF${suffix}.pdf`, INSTANT, INSTANT);
    insertVersion.run(versionId, fileId, `files/${versionId}`, INSTANT);

    const excepted = index % profile.exceptionInEvery === 0;
    const parked = !excepted && index % profile.parkedInEvery === 0;
    // The last hundred stay pending and unparked: the measured write needs a document it can claim,
    // and one per iteration so no iteration measures a no-op update.
    const writable = index >= profile.reviewDocumentCount - 100;
    const state = excepted ? "excepted" : writable || parked ? "pending" : "processed";
    const processed = state === "processed";
    const undated = index % profile.undatedInEvery === 0;
    const duplicate = processed && !writable && index % profile.duplicateInEvery === 0;

    // Families are contiguous runs, which is what an email and its attachments are when a load walks
    // a mailbox: the parent is the run's head and every member points at it.
    const inFamily = Math.floor(index / profile.familySize) % profile.familyInEvery === 0;
    const familyPosition = index % profile.familySize;
    const familyId = inFamily ? reviewDocumentId(index - familyPosition) : documentId;
    const familyRole = !inFamily ? "standalone" : familyPosition === 0 ? "parent" : "attachment";

    // A duplicate points at the previous primary and inherits its group. Real deduplication groups by
    // content hash; here the group is assigned directly, because what the reads cost depends on the
    // shape of the grouping and not on how it was arrived at.
    if (processed && !duplicate) lastPrimaryId = documentId;
    const dedupGroup = duplicate ? `sha256-lp-${lastPrimaryId}` : `sha256-lp-${suffix}`;

    insertDocument.run(
      documentId,
      DISCOVERY_REVIEW_SET_ID,
      discoveryLoadId(index % profile.loadCount),
      recordCustodianId(index % profile.recordCustodianCount),
      versionId,
      familyId,
      familyRole,
      inFamily ? familyPosition : 0,
      `PLTF${suffix}.pdf`,
      `sha256-lp-${suffix}`,
      processed ? dedupGroup : null,
      duplicate ? 0 : 1,
      state,
      parked ? "the recognition engine is not deployed" : null,
      // Nothing is indexed: the index engine is not deployed anywhere, so a corpus that reported
      // otherwise would measure a state no firm is in.
      processed ? "deferred" : null,
      state === "pending" ? null : "pdf",
      processed ? "discovery-engine" : null,
      processed ? 0 : null,
      processed ? 4 : null,
      undated ? null : documentDate(index),
      undated ? null : "documentProperties",
      processed ? `discovery/${DISCOVERY_REVIEW_SET_ID}/text/${documentId}.txt` : null,
      processed ? `discovery/${DISCOVERY_REVIEW_SET_ID}/metadata/${documentId}.json` : null,
      INSTANT,
      INSTANT,
    );

    if (excepted) {
      insertException.run(
        `reviewDocumentException_lp${suffix}`,
        DISCOVERY_REVIEW_SET_ID,
        discoveryLoadId(index % profile.loadCount),
        documentId,
        codes[index % codes.length]!,
        INSTANT,
      );
      exceptionCount += 1;
    }
    if (duplicate && lastPrimaryId !== "") {
      insertOccurrence.run(
        `reviewDocumentOccurrence_lp${suffix}`,
        DISCOVERY_REVIEW_SET_ID,
        lastPrimaryId,
        documentId,
        recordCustodianId(index % profile.recordCustodianCount),
        discoveryLoadId(index % profile.loadCount),
        INSTANT,
      );
      occurrenceCount += 1;
      if (dedupPrimaryId === "") dedupPrimaryId = lastPrimaryId;
    }
    if (writable) writableIds.push(documentId);

    // Halfway through, as the resume cursors: measuring the first page would measure the one page a
    // keyset walk is cheapest on.
    const halfway = Math.floor(profile.reviewDocumentCount / 2);
    if (index === halfway) {
      midWalkCursorId = documentId;
      midListCursorSortDate = documentDate(index);
      midListCursorId = documentId;
    }
    if (undated && index > halfway && undatedCursorId === "") undatedCursorId = documentId;
    if (inFamily && familyPosition === 0 && filterFamilyId === "") filterFamilyId = documentId;
  }
  raw.exec("COMMIT");

  return {
    reviewSetId: DISCOVERY_REVIEW_SET_ID,
    matterId: DISCOVERY_MATTER_ID,
    memberUserId: DISCOVERY_MEMBER_ID,
    busiestLoadId: discoveryLoadId(0),
    midWalkCursorId,
    midListCursorSortDate,
    midListCursorId,
    undatedCursorId,
    filterRecordCustodianId: recordCustodianId(0),
    filterFamilyId,
    dedupPrimaryId,
    writableIds,
    reviewDocumentCount: profile.reviewDocumentCount,
    exceptionCount,
    occurrenceCount,
  };
}
