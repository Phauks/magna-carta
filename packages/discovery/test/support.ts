import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type {
  DiscoveryLoadId,
  MatterId,
  RecordCustodianId,
  ReviewDocumentId,
  ReviewSetId,
  UserId,
} from "@magna-carta/identifiers/types";
import { reviewSetAccessPredicate } from "../src/review-set-visibility.ts";

// Shared scaffolding for the coding and access-list tests: a migrated in-memory per-firm database, a
// fixed clock, a deterministic random source, and one review set with a small family in it.
//
// The services return effects and the caller commits them, so a test that forgets to commit is
// testing nothing — `commit` is the one-liner that keeps that from happening quietly.

export const REVIEWER = "user_discoveryReviewer" as UserId;
export const OUTSIDER = "user_discoveryOutsider" as UserId;
export const MATTER = "matter_discoveryCoding000000000000" as MatterId;
export const REVIEW_SET = "reviewSet_codingTest00000000000000" as ReviewSetId;
export const WALLED_REVIEW_SET = "reviewSet_walledTest00000000000000" as ReviewSetId;
export const LOAD = "discoveryLoad_codingTest0000000000000" as DiscoveryLoadId;
export const RECORD_CUSTODIAN = "recordCustodian_codingTest0000000000000" as RecordCustodianId;

// A two-member family plus a standalone, so the family gesture and the family-conflict read both have
// something real to work over.
export const PARENT_DOCUMENT = "reviewDocument_parent0000000000000000" as ReviewDocumentId;
export const ATTACHMENT_DOCUMENT = "reviewDocument_attachment000000000000" as ReviewDocumentId;
export const STANDALONE_DOCUMENT = "reviewDocument_standalone000000000000" as ReviewDocumentId;
// In the walled review set, which the reviewer is deliberately NOT on the access list for.
export const WALLED_DOCUMENT = "reviewDocument_walled0000000000000000" as ReviewDocumentId;

export const clock = { now: () => "2026-08-08T12:00:00.000Z" };

// A fresh seed per call rather than a fixed one: two acts in one test are two acts, and a seed reused
// across them mints the same handle twice and aborts on the primary key. Deterministic within a run
// (the counter is), distinct between calls (the counter moves).
let seedCounter = 0;

export function serviceOptions(actorUserId: UserId = REVIEWER) {
  seedCounter += 1;
  return { clock, actorUserId, randomSource: seededRandomSource(seedCounter) };
}

// The reviewer's own predicate, and an outsider's. Every read and write in these tests goes through
// one of the two, because that is how the production code reaches the database.
export const reviewerAccess = reviewSetAccessPredicate(REVIEWER);
export const outsiderAccess = reviewSetAccessPredicate(OUTSIDER);

export async function commit(database: BatchDatabase, effect: EffectWrite): Promise<void> {
  await commitEffectBatch(database, effect, { now: () => clock.now() });
}

const INSTANT = "2026-08-01T00:00:00.000Z";

export function migratedDatabase() {
  const created = createMigratedNodeDatabase("per-firm");
  seedCorpus(created.raw);
  return created;
}

function seedCorpus(raw: ReturnType<typeof createMigratedNodeDatabase>["raw"]): void {
  for (const [userId, name] of [
    [REVIEWER, "Discovery Reviewer"],
    [OUTSIDER, "Discovery Outsider"],
  ] as const) {
    raw.exec(
      `INSERT INTO member (user_id, display_name, status, created_at) ` +
        `VALUES ('${userId}', '${name}', 'active', '${INSTANT}')`,
    );
  }
  raw.exec(
    `INSERT INTO matter (id, title, status, responsible_member_id, opened_at, created_at, updated_at) ` +
      `VALUES ('${MATTER}', 'Smith v Jones', 'open', '${REVIEWER}', '${INSTANT}', '${INSTANT}', '${INSTANT}')`,
  );
  for (const reviewSetId of [REVIEW_SET, WALLED_REVIEW_SET]) {
    raw.exec(
      `INSERT INTO review_set (id, matter_id, name, state, document_ceiling, document_count, ` +
        `semantic_index_enabled, created_by, created_at, updated_at) VALUES ` +
        `('${reviewSetId}', '${MATTER}', '${reviewSetId}', 'open', 250000, 0, 0, '${REVIEWER}', ` +
        `'${INSTANT}', '${INSTANT}')`,
    );
  }
  // The reviewer is on ONE list and not the other. That asymmetry is what every wall assertion in
  // these suites turns on.
  raw.exec(
    `INSERT INTO review_set_access (id, review_set_id, member_user_id, granted_by, created_at) ` +
      `VALUES ('reviewSetAccess_seed000000000000000', '${REVIEW_SET}', '${REVIEWER}', '${REVIEWER}', '${INSTANT}')`,
  );
  raw.exec(
    `INSERT INTO review_set_access (id, review_set_id, member_user_id, granted_by, created_at) ` +
      `VALUES ('reviewSetAccess_walled00000000000000', '${WALLED_REVIEW_SET}', '${OUTSIDER}', '${OUTSIDER}', '${INSTANT}')`,
  );
  raw.exec(
    `INSERT INTO record_custodian (id, review_set_id, display_name, kind, created_at, updated_at) ` +
      `VALUES ('${RECORD_CUSTODIAN}', '${REVIEW_SET}', 'A. Keeper', 'person', '${INSTANT}', '${INSTANT}')`,
  );
  raw.exec(
    `INSERT INTO discovery_load (id, review_set_id, lane, state, transcript_scope, ` +
      `declared_document_count, loaded_document_count, processed_count, exception_count, ` +
      `initiated_by, initiated_at, created_at, updated_at) VALUES ` +
      `('${LOAD}', '${REVIEW_SET}', 'internal-files', 'declared', 'exclude', 0, 0, 0, 0, ` +
      `'${REVIEWER}', '${INSTANT}', '${INSTANT}', '${INSTANT}')`,
  );

  // A review document points at exactly one thing, and the schema CHECK and a real foreign key both
  // say so — so each seeded document gets a File Manager file and committed version behind it. None
  // of these suites reads a byte; the rows exist because a review document is a POINTER, and a
  // pointer to nothing is not the thing under test.
  const insertVersion = (fileVersionId: string, ordinal: number) => {
    const fileId = `file_codingTest${String(ordinal).padStart(8, "0")}0000000000`.slice(0, 26);
    raw.exec(
      `INSERT INTO file (id, matter_id, name, created_at, updated_at) ` +
        `VALUES ('${fileId}', '${MATTER}', 'coded-${ordinal}.pdf', '${INSTANT}', '${INSTANT}')`,
    );
    raw.exec(
      `INSERT INTO file_version (id, file_id, version_number, r2_key, status, scan_verdict, ` +
        `uploaded_by, created_at, committed_at) VALUES ('${fileVersionId}', '${fileId}', 1, ` +
        `'files/${fileId}/${fileVersionId}', 'clean', 'clean', '${REVIEWER}', '${INSTANT}', ` +
        `'${INSTANT}')`,
    );
  };

  const insertDocument = (
    id: ReviewDocumentId,
    reviewSetId: ReviewSetId,
    familyId: ReviewDocumentId,
    familyRole: string,
    familySequence: number,
    fileVersionId: string,
    ordinal: number,
  ) => {
    insertVersion(fileVersionId, ordinal);
    raw.exec(
      `INSERT INTO review_document (id, review_set_id, discovery_load_id, record_custodian_id, ` +
        `source_kind, file_version_id, family_id, family_role, family_sequence, processing_state, ` +
        `format_identified, sort_date, created_at, updated_at) VALUES ('${id}', '${reviewSetId}', ` +
        `'${LOAD}', '${RECORD_CUSTODIAN}', 'file_version', '${fileVersionId}', '${familyId}', ` +
        `'${familyRole}', ${familySequence}, 'processed', 'application/pdf', '${INSTANT}', ` +
        `'${INSTANT}', '${INSTANT}')`,
    );
  };
  insertDocument(
    PARENT_DOCUMENT,
    REVIEW_SET,
    PARENT_DOCUMENT,
    "parent",
    0,
    "fileVersion_codingParent00000000000",
    1,
  );
  insertDocument(
    ATTACHMENT_DOCUMENT,
    REVIEW_SET,
    PARENT_DOCUMENT,
    "attachment",
    1,
    "fileVersion_codingAttachment0000000",
    2,
  );
  insertDocument(
    STANDALONE_DOCUMENT,
    REVIEW_SET,
    STANDALONE_DOCUMENT,
    "standalone",
    0,
    "fileVersion_codingStandalone0000000",
    3,
  );
  // The walled corpus gets its own load and its own record custodian, so the row is well-formed
  // without giving the reviewer anything to reach it through.
  insertVersion("fileVersion_codingWalled00000000000", 4);
  raw.exec(
    `INSERT INTO record_custodian (id, review_set_id, display_name, kind, created_at, updated_at) ` +
      `VALUES ('recordCustodian_walled000000000000000', '${WALLED_REVIEW_SET}', 'B. Keeper', ` +
      `'person', '${INSTANT}', '${INSTANT}')`,
  );
  raw.exec(
    `INSERT INTO discovery_load (id, review_set_id, lane, state, transcript_scope, ` +
      `declared_document_count, loaded_document_count, processed_count, exception_count, ` +
      `initiated_by, initiated_at, created_at, updated_at) VALUES ` +
      `('discoveryLoad_walled00000000000000000', '${WALLED_REVIEW_SET}', 'internal-files', ` +
      `'declared', 'exclude', 0, 0, 0, 0, '${OUTSIDER}', '${INSTANT}', '${INSTANT}', '${INSTANT}')`,
  );
  raw.exec(
    `INSERT INTO review_document (id, review_set_id, discovery_load_id, record_custodian_id, ` +
      `source_kind, file_version_id, family_id, family_role, family_sequence, processing_state, ` +
      `format_identified, sort_date, created_at, updated_at) VALUES ('${WALLED_DOCUMENT}', ` +
      `'${WALLED_REVIEW_SET}', 'discoveryLoad_walled00000000000000000', ` +
      `'recordCustodian_walled000000000000000', 'file_version', ` +
      `'fileVersion_codingWalled00000000000', '${WALLED_DOCUMENT}', 'standalone', 0, 'processed', ` +
      `'application/pdf', '${INSTANT}', '${INSTANT}', '${INSTANT}')`,
  );
}
