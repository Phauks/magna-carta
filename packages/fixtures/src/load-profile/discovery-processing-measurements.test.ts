import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import {
  explainStatement,
  findFullScans,
  findTempBtreeSorts,
  runMeasurements,
  type LabeledPlan,
} from "./runner.ts";

// The discovery PROCESSING reads and writes, measured at the standard review-set volume the design
// names: 25,000 review documents in one review set, one load, several record custodians, with a
// realistic scattering of exceptions and parked documents over them.
//
// It seeds its own volume rather than riding the shared snapshot, on the email-filing precedent: the
// corpus a review set holds is set by an outside party and is an order of magnitude larger than
// everything else in a firm's database, so folding it into the shared generator would change the
// identity of every other domain's baseline for a table none of them read. The full discovery volume
// joins the shared profile with the review-document LIST read, which is the read the review surface
// sits on and belongs with that surface.
//
// WHAT IS MEASURED AND WHY IT IS THESE FIVE. Everything the processing lane does per document is one
// indexed row write and two R2 puts — constant, and constant work does not belong in a load profile.
// What DOES scale with the corpus is the five operations below, and each of them is on a path that
// runs hundreds of times per load or reads the whole review set at once:
//
//   1. the DISPATCH PAGE — one page of a load's still-unprocessed documents with the object each
//      points at, keyset-paged. A load at the ceiling is 2,500 of these, and the trap is that a
//      review-set-led index narrows nothing when the load IS the review set;
//   2. the RECONCILIATION TALLY — loaded against processed plus excepted, over the whole load. It is
//      an aggregate and scans by nature, which is exactly why it is measured rather than assumed;
//   3. the EXCEPTION COUNTS BY CODE — the exception report's spine, a group-by over the review set;
//   4. the PARKED COUNT — what a review set is still owed while an engine is undeployed;
//   5. the PER-DOCUMENT PROCESSED WRITE — the row update the consumer commits, measured at volume so
//      a later index added to this table is measured against what it costs the write path.

const NOW = "2026-08-15T00:00:00.000Z";
const REVIEW_DOCUMENT_COUNT = 25_000;
// A production of this size is not one custodian's mailbox. Five is the shape a real received
// production has, and it is what makes the custodian filter a filter rather than a no-op.
const RECORD_CUSTODIAN_COUNT = 5;
// Roughly one document in forty is unreadable in a real production — locked spreadsheets, files
// damaged in transfer, photographs of whiteboards. The rate matters because it decides whether the
// exception group-by reads a handful of rows or a meaningful slice of the corpus.
const EXCEPTION_IN = 40;
// And a slice is parked, which is what a review set looks like while an engine is undeployed.
const PARKED_IN = 25;
const DISPATCH_PAGE_SIZE = 100;

const REVIEW_SET_ID = "reviewSet_loadProfile00000000000";
const LOAD_ID = "discoveryLoad_loadProfile0000000";
const MATTER_ID = "matter_loadProfile0000000000";
const MEMBER_ID = "user_loadProfile000000000000";

function pad(value: number): string {
  return String(value).padStart(8, "0");
}

interface SeededCorpus {
  // A review document still `pending` in the middle of the walk — the cursor a dispatch turn resumes
  // from, taken well past the head so the page is measured where a real walk spends its time.
  readonly midWalkCursor: string;
  // A document the measured write claims and processes, one per iteration.
  readonly writableIds: readonly string[];
}

function seedVolume(raw: DatabaseSync): SeededCorpus {
  raw.exec("PRAGMA foreign_keys = OFF");
  raw
    .prepare(
      "INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at) VALUES (?, 'LP', 'active', 0, ?)",
    )
    .run(MEMBER_ID, NOW);
  raw
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at) VALUES (?, 'M', 'open', ?, 0, ?, ?)",
    )
    .run(MATTER_ID, MEMBER_ID, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO review_set (id, matter_id, name, state, document_ceiling, document_count,
         semantic_index_enabled, created_by, created_at, updated_at)
       VALUES (?, ?, 'Plaintiff production', 'open', 250000, ?, 0, ?, ?, ?)`,
    )
    .run(REVIEW_SET_ID, MATTER_ID, REVIEW_DOCUMENT_COUNT, MEMBER_ID, NOW, NOW);
  const insertCustodian = raw.prepare(
    "INSERT INTO record_custodian (id, review_set_id, display_name, kind, created_at, updated_at) VALUES (?, ?, ?, 'person', ?, ?)",
  );
  const custodianIds: string[] = [];
  for (let index = 0; index < RECORD_CUSTODIAN_COUNT; index += 1) {
    const id = `recordCustodian_lp${pad(index)}`;
    insertCustodian.run(id, REVIEW_SET_ID, `Custodian ${index}`, NOW, NOW);
    custodianIds.push(id);
  }
  raw
    .prepare(
      `INSERT INTO discovery_load (id, review_set_id, lane, state, transcript_scope,
         declared_document_count, loaded_document_count, processed_count, exception_count,
         initiated_by, initiated_at, created_at, updated_at)
       VALUES (?, ?, 'received-production', 'processing', 'exclude', ?, ?, 0, 0, ?, ?, ?, ?)`,
    )
    .run(
      LOAD_ID,
      REVIEW_SET_ID,
      REVIEW_DOCUMENT_COUNT,
      REVIEW_DOCUMENT_COUNT,
      MEMBER_ID,
      NOW,
      NOW,
      NOW,
    );

  const insertFile = raw.prepare(
    "INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  );
  const insertVersion = raw.prepare(
    "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, sniffed_content_type, status, scan_verdict, created_at) VALUES (?, ?, 1, ?, 40960, 'application/pdf', 'clean', 'clean', ?)",
  );
  const insertDocument = raw.prepare(
    `INSERT INTO review_document (id, review_set_id, discovery_load_id, record_custodian_id,
       source_kind, file_version_id, family_id, family_role, family_sequence, source_name,
       size_bytes, content_sha256, processing_state, processing_deferred_reason, format_identified,
       extraction_route, pages_recognized, sort_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'file_version', ?, ?, 'standalone', 0, ?, 40960, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertException = raw.prepare(
    "INSERT INTO review_document_exception (id, review_set_id, review_document_id, stage, code, detail, created_at) VALUES (?, ?, ?, 'extract', ?, NULL, ?)",
  );
  // The codes a real production actually produces, in roughly the proportions it produces them.
  const codes = ["encrypted", "password-protected", "corrupt", "no-text-extracted", "oversize"];

  const writableIds: string[] = [];
  let midWalkCursor = "";
  raw.exec("BEGIN");
  for (let index = 0; index < REVIEW_DOCUMENT_COUNT; index += 1) {
    const suffix = pad(index);
    const fileId = `file_lp${suffix}`;
    const versionId = `fileVersion_lp${suffix}`;
    const documentId = `reviewDocument_lp${suffix}`;
    insertFile.run(fileId, MATTER_ID, `PLTF${suffix}.pdf`, NOW, NOW);
    insertVersion.run(versionId, fileId, `files/${versionId}`, NOW);

    const excepted = index % EXCEPTION_IN === 0;
    const parked = !excepted && index % PARKED_IN === 0;
    // The last hundred stay pending and unparked: the measured write needs a document it can claim,
    // and one per iteration so no iteration measures a no-op update.
    const writable = index >= REVIEW_DOCUMENT_COUNT - 100;
    const state = excepted ? "excepted" : writable || parked ? "pending" : "processed";
    insertDocument.run(
      documentId,
      REVIEW_SET_ID,
      LOAD_ID,
      custodianIds[index % RECORD_CUSTODIAN_COUNT]!,
      versionId,
      documentId,
      `PLTF${suffix}.pdf`,
      `sha256-lp-${suffix}`,
      state,
      parked ? "the recognition engine is not deployed" : null,
      state === "pending" ? null : "pdf",
      state === "processed" ? "discovery-engine" : null,
      state === "processed" ? 0 : null,
      `2024-${String((index % 12) + 1).padStart(2, "0")}-01T00:00:00.000Z`,
      NOW,
      NOW,
    );
    if (excepted) {
      insertException.run(
        `reviewDocumentException_lp${suffix}`,
        REVIEW_SET_ID,
        documentId,
        codes[index % codes.length]!,
        NOW,
      );
    }
    if (writable) writableIds.push(documentId);
    // Halfway through the corpus, as the resume cursor: measuring the first page would measure the
    // one page a keyset walk is cheapest on.
    if (index === Math.floor(REVIEW_DOCUMENT_COUNT / 2)) midWalkCursor = documentId;
  }
  raw.exec("COMMIT");
  return { midWalkCursor, writableIds };
}

const DISPATCH_PAGE_SQL = `SELECT review_document.id AS id,
    COALESCE(file_version.r2_key, email_message.original_r2_key) AS sourceKey,
    file_version.sniffed_content_type AS contentType,
    COALESCE(file_version.status, 'clean') AS sourceStatus
  FROM review_document
  LEFT JOIN file_version ON file_version.id = review_document.file_version_id
  LEFT JOIN email_message ON email_message.id = review_document.email_message_id
  WHERE review_document.discovery_load_id = ?
    AND review_document.processing_state = 'pending'
    AND review_document.id > ?
  ORDER BY review_document.id ASC LIMIT ?`;

const RECONCILIATION_SQL = `SELECT COUNT(*) AS loaded,
    SUM(CASE WHEN processing_state = 'processed' THEN 1 ELSE 0 END) AS processed,
    SUM(CASE WHEN processing_state = 'excepted' THEN 1 ELSE 0 END) AS excepted,
    SUM(CASE WHEN processing_state IN ('pending', 'processing') THEN 1 ELSE 0 END) AS outstanding
  FROM review_document WHERE discovery_load_id = ?`;

const EXCEPTION_COUNTS_SQL = `SELECT code, COUNT(DISTINCT review_document_id) AS document_count
  FROM review_document_exception WHERE review_set_id = ? GROUP BY code ORDER BY code ASC`;

const PARKED_COUNT_SQL = `SELECT COUNT(*) AS document_count FROM review_document
  WHERE review_set_id = ? AND processing_state = 'pending'
    AND processing_deferred_reason IS NOT NULL`;

const CLAIM_SQL = `UPDATE review_document SET processing_state = 'processing',
    processing_deferred_reason = NULL, updated_at = ?
  WHERE id = ? AND processing_state IN ('pending', 'processing')`;

const PROCESSED_SQL = `UPDATE review_document SET processing_state = 'processed',
    text_r2_key = ?, metadata_r2_key = ?, format_identified = 'pdf', page_count = 4,
    pages_recognized = 0, extraction_route = 'discovery-engine', text_fingerprint = ?,
    sort_date = ?, sort_date_source = 'documentProperties', processing_deferred_reason = NULL,
    updated_at = ?
  WHERE id = ? AND processing_state = 'processing'`;

describe("discovery processing at review-set volume (load profile)", () => {
  it("every volume-shaped read walks an index, and the paged walk sorts from one", () => {
    const { raw } = createMigratedNodeDatabase("per-firm");
    const corpus = seedVolume(raw);

    const plans: LabeledPlan[] = [
      {
        label: "dispatchPage",
        details: explainStatement(raw, DISPATCH_PAGE_SQL, [
          LOAD_ID,
          corpus.midWalkCursor,
          DISPATCH_PAGE_SIZE,
        ]),
      },
      {
        label: "exceptionCountsByCode",
        details: explainStatement(raw, EXCEPTION_COUNTS_SQL, [REVIEW_SET_ID]),
      },
      {
        label: "parkedDocumentCount",
        details: explainStatement(raw, PARKED_COUNT_SQL, [REVIEW_SET_ID]),
      },
      {
        label: "claimReviewDocument",
        details: explainStatement(raw, CLAIM_SQL, [NOW, corpus.writableIds[0]!]),
      },
      // The reconciliation is a whole-load aggregate. It scans BY NATURE — that is what "count every
      // document in this load and add them up" is — so it is allowlisted rather than pretended away,
      // and it is measured below precisely because an aggregate over the largest table in the firm's
      // database is the one that has to be looked at rather than assumed.
      {
        label: "reconciliationTally",
        details: explainStatement(raw, RECONCILIATION_SQL, [LOAD_ID]),
      },
    ];

    expect(findFullScans(plans, ["reconciliationTally"])).toEqual([]);
    // The dispatch walk's filter and its id sort must both come from one index. Without that the
    // walk materializes and sorts a quarter-million rows on every one of its hundreds of turns,
    // which is the difference between a keyset cursor and a lie about one.
    expect(findTempBtreeSorts(plans.filter((plan) => plan.label === "dispatchPage"))).toEqual([]);

    raw.close();
  });

  it("reports the measured cost of each volume-shaped operation", async () => {
    const { raw } = createMigratedNodeDatabase("per-firm");
    const corpus = seedVolume(raw);
    let writeCursor = 0;

    const results = await runMeasurements(
      { raw, corpus },
      [
        {
          name: "discovery-dispatch.page-mid-walk",
          operation: async ({ raw: database }) => {
            database
              .prepare(DISPATCH_PAGE_SQL)
              .all(LOAD_ID, corpus.midWalkCursor, DISPATCH_PAGE_SIZE);
          },
        },
        {
          name: "discovery-load.reconciliation-tally",
          operation: async ({ raw: database }) => {
            database.prepare(RECONCILIATION_SQL).all(LOAD_ID);
          },
        },
        {
          name: "discovery-report.exception-counts-by-code",
          operation: async ({ raw: database }) => {
            database.prepare(EXCEPTION_COUNTS_SQL).all(REVIEW_SET_ID);
          },
        },
        {
          name: "discovery-report.parked-document-count",
          operation: async ({ raw: database }) => {
            database.prepare(PARKED_COUNT_SQL).all(REVIEW_SET_ID);
          },
        },
        {
          // Claim plus the terminal write, which is the pair the consumer commits per document. Each
          // iteration takes its own document, because a claim is not idempotent in cost: re-running
          // it against an already-processed row would measure an update that matches nothing.
          name: "discovery-processing.per-document-write",
          operation: async ({ raw: database }) => {
            const id = corpus.writableIds[writeCursor % corpus.writableIds.length]!;
            writeCursor += 1;
            database.prepare(CLAIM_SQL).run(NOW, id);
            database
              .prepare(PROCESSED_SQL)
              .run(
                `discovery/${REVIEW_SET_ID}/text/${id}.txt`,
                `discovery/${REVIEW_SET_ID}/metadata/${id}.json`,
                "9f2c1a04bb37de55",
                "2024-03-01T00:00:00.000Z",
                NOW,
                id,
              );
          },
        },
      ],
      { warmupIterations: 5, iterations: 25 },
    );

    // Printed rather than asserted against a threshold. A number here is machine-relative and decides
    // regressions and growth curves across commits on one machine — never an absolute latency, and
    // never a pass/fail gate that would turn a busy laptop into a red build.
    for (const result of results) {
      // eslint-disable-next-line no-console
      console.log(
        `${result.name}: median ${result.medianMs}ms p95 ${result.p95Ms}ms min ${result.minMs}ms`,
      );
    }
    expect(results).toHaveLength(5);

    const pageSize = raw.prepare("PRAGMA page_size").get() as { page_size: number };
    const pageCount = raw.prepare("PRAGMA page_count").get() as { page_count: number };
    // THE NUMBER THE CEILING IS DERIVED FROM. A review set is the only object in the platform whose
    // size is set by an outside party, and the per-review-set ceiling exists because this arithmetic
    // has an end: printed here so it is re-derived against a measurement rather than defended by
    // argument.
    // eslint-disable-next-line no-console
    console.log(
      `database after ${REVIEW_DOCUMENT_COUNT} review documents: ${Math.round((pageSize.page_size * pageCount.page_count) / 1024 / 1024)} MiB`,
    );

    raw.close();
  });
});
