import { describe, expect, it } from "vitest";
import type {
  DiscoveryLoadId,
  RecordCustodianId,
  ReviewDocumentId,
  ReviewSetId,
} from "@magna-carta/identifiers/types";
import {
  readReviewDocumentPage,
  readReviewSetExceptionPage,
  readVisibleExceptionCounts,
  readVisibleOccurrences,
  readVisibleReviewSet,
  readVisibleReviewSetsForMatter,
} from "../src/review-reads.ts";
import { readRecordCustodians } from "../src/record-custodian-statements.ts";
import {
  ATTACHMENT_DOCUMENT,
  LOAD,
  MATTER,
  migratedDatabase,
  outsiderAccess,
  PARENT_DOCUMENT,
  RECORD_CUSTODIAN,
  REVIEW_SET,
  reviewerAccess,
  STANDALONE_DOCUMENT,
  WALLED_DOCUMENT,
  WALLED_REVIEW_SET,
} from "./support.ts";

// The reads the review surface pages through, and the wall every one of them stands behind.
//
// The seeded corpus has two review sets on ONE matter, and the reviewer is on the list for exactly one
// of them. That asymmetry is what every assertion here turns on: a read that forgot the predicate
// would return the walled corpus and look completely ordinary doing it.

const INSTANT = "2026-08-01T00:00:00.000Z";
const OTHER_CUSTODIAN = "recordCustodian_secondKeeper00000000" as RecordCustodianId;
const SECOND_LOAD = "discoveryLoad_secondLoad000000000000" as DiscoveryLoadId;

type Database = ReturnType<typeof migratedDatabase>["database"];
type Raw = ReturnType<typeof migratedDatabase>["raw"];

// Enough shape for the filters to be filters rather than no-ops: a second record custodian, a
// second load, an undated document, and a document carrying two exception reasons.
function widenCorpus(raw: Raw): { readonly undated: ReviewDocumentId } {
  raw.exec(
    `INSERT INTO record_custodian (id, review_set_id, display_name, kind, created_at, updated_at) ` +
      `VALUES ('${OTHER_CUSTODIAN}', '${REVIEW_SET}', 'B. Keeper', 'person', '${INSTANT}', '${INSTANT}')`,
  );
  raw.exec(
    `INSERT INTO discovery_load (id, review_set_id, lane, state, transcript_scope, ` +
      `declared_document_count, loaded_document_count, processed_count, exception_count, ` +
      `initiated_by, initiated_at, created_at, updated_at) VALUES ` +
      `('${SECOND_LOAD}', '${REVIEW_SET}', 'received-production', 'declared', 'exclude', 0, 0, 0, 0, ` +
      `'user_discoveryReviewer', '${INSTANT}', '${INSTANT}', '${INSTANT}')`,
  );

  const undated = "reviewDocument_undated00000000000000" as ReviewDocumentId;
  raw.exec(
    `INSERT INTO file (id, matter_id, name, created_at, updated_at) ` +
      `VALUES ('file_undated0000000000000', '${MATTER}', 'undated.tif', '${INSTANT}', '${INSTANT}')`,
  );
  raw.exec(
    `INSERT INTO file_version (id, file_id, version_number, r2_key, status, scan_verdict, ` +
      `uploaded_by, created_at, committed_at) VALUES ('fileVersion_undated00000000000000', ` +
      `'file_undated0000000000000', 1, 'files/undated', 'clean', 'clean', 'user_discoveryReviewer', ` +
      `'${INSTANT}', '${INSTANT}')`,
  );
  // No sort_date: a scan a production gave no metadata for. It has to come back LAST, after every
  // dated document, and it has to be reachable — a document that pages off the end of the walk is a
  // document nobody reviews.
  raw.exec(
    `INSERT INTO review_document (id, review_set_id, discovery_load_id, record_custodian_id, ` +
      `source_kind, file_version_id, family_id, family_role, family_sequence, processing_state, ` +
      `created_at, updated_at) VALUES ('${undated}', '${REVIEW_SET}', '${SECOND_LOAD}', ` +
      `'${OTHER_CUSTODIAN}', 'file_version', 'fileVersion_undated00000000000000', '${undated}', ` +
      `'standalone', 0, 'excepted', '${INSTANT}', '${INSTANT}')`,
  );
  // Two reasons on one document, which is normal and is what the pair-keyed walk exists for.
  for (const [suffix, code] of [
    ["a", "encrypted"],
    ["b", "oversize"],
  ] as const) {
    raw.exec(
      `INSERT INTO review_document_exception (id, review_set_id, discovery_load_id, ` +
        `review_document_id, stage, code, created_at) VALUES ` +
        `('reviewDocumentException_undated${suffix}0000000', '${REVIEW_SET}', '${SECOND_LOAD}', ` +
        `'${undated}', 'extract', '${code}', '${INSTANT}')`,
    );
  }
  // And one reason in the WALLED corpus, so the counts read has something it must not see.
  raw.exec(
    `INSERT INTO review_document_exception (id, review_set_id, discovery_load_id, ` +
      `review_document_id, stage, code, created_at) VALUES ` +
      `('reviewDocumentException_walled000000000', '${WALLED_REVIEW_SET}', ` +
      `'discoveryLoad_walled00000000000000000', '${WALLED_DOCUMENT}', ` +
      `'extract', 'corrupt', '${INSTANT}')`,
  );
  return { undated };
}

function page(database: Database, options: Parameters<typeof readReviewDocumentPage>[3] = {}) {
  return readReviewDocumentPage(database, REVIEW_SET, reviewerAccess, options, undefined, 50);
}

describe("the review-set list is what a member may reach and nothing else", () => {
  it("returns the corpus the reviewer is on the list for and never the walled one on the same matter", async () => {
    const { database } = migratedDatabase();
    const visible = await readVisibleReviewSetsForMatter(database, MATTER, reviewerAccess, 50);
    expect(visible.data.map((row) => row.id)).toEqual([REVIEW_SET]);
  });

  it("returns the OTHER corpus for the member who is on the other list", async () => {
    const { database } = migratedDatabase();
    const visible = await readVisibleReviewSetsForMatter(database, MATTER, outsiderAccess, 50);
    expect(visible.data.map((row) => row.id)).toEqual([WALLED_REVIEW_SET]);
  });

  it("answers ABSENT rather than refused for a corpus the member is not on", async () => {
    const { database } = migratedDatabase();
    expect(await readVisibleReviewSet(database, WALLED_REVIEW_SET, reviewerAccess)).toBeUndefined();
    expect(await readVisibleReviewSet(database, REVIEW_SET, reviewerAccess)).toBeDefined();
  });
});

describe("the review-document list page", () => {
  it("returns the review set's documents and none from the walled corpus", async () => {
    const { database } = migratedDatabase();
    const result = await page(database);
    const ids = result.documents.map((row) => row.id);
    expect(ids).toContain(PARENT_DOCUMENT);
    expect(ids).toContain(ATTACHMENT_DOCUMENT);
    expect(ids).toContain(STANDALONE_DOCUMENT);
    expect(ids).not.toContain(WALLED_DOCUMENT);
  });

  it("returns nothing at all to a member off the list", async () => {
    const { database } = migratedDatabase();
    const result = await readReviewDocumentPage(
      database,
      REVIEW_SET,
      outsiderAccess,
      {},
      undefined,
      50,
    );
    expect(result.documents).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it("puts the undated document after every dated one, and still returns it", async () => {
    const { database, raw } = migratedDatabase();
    const { undated } = widenCorpus(raw);
    const result = await page(database);
    // Last, not missing. A production routinely arrives with documents nothing can date, and a walk
    // that sorted them off the end would hide them from review entirely.
    expect(result.documents.at(-1)?.id).toBe(undated);
    expect(result.documents.at(-1)?.sort_date).toBeNull();
  });

  it("pages across the boundary between dated documents and the undated tail without dropping one", async () => {
    const { database, raw } = migratedDatabase();
    const { undated } = widenCorpus(raw);
    const everything = (await page(database)).documents.map((row) => row.id);
    expect(everything).toHaveLength(4);

    // One document at a time, so every page boundary in the corpus — including the one between the
    // two segments — is crossed. A cursor that could not express "in the undated tail" would restart
    // the walk at the top here and never terminate.
    const walked: string[] = [];
    let cursor = undefined as Parameters<typeof readReviewDocumentPage>[4];
    for (let turn = 0; turn < 10; turn += 1) {
      const result = await readReviewDocumentPage(
        database,
        REVIEW_SET,
        reviewerAccess,
        {},
        cursor,
        1,
      );
      walked.push(...result.documents.map((row) => row.id));
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
    expect(walked).toEqual(everything);
    expect(walked).toContain(undated);
    // Every document once. A boundary the cursor cannot express shows up here as a repeat.
    expect(new Set(walked).size).toBe(walked.length);
  });

  it("filters by Custodian of Record, by load, by family, and by processing state", async () => {
    const { database, raw } = migratedDatabase();
    const { undated } = widenCorpus(raw);

    expect(
      (await page(database, { recordCustodianId: OTHER_CUSTODIAN })).documents.map((row) => row.id),
    ).toEqual([undated]);
    expect(
      (await page(database, { discoveryLoadId: LOAD })).documents.map((row) => row.id).sort(),
    ).toEqual([ATTACHMENT_DOCUMENT, PARENT_DOCUMENT, STANDALONE_DOCUMENT].sort());
    expect(
      (await page(database, { familyId: PARENT_DOCUMENT })).documents.map((row) => row.id).sort(),
    ).toEqual([ATTACHMENT_DOCUMENT, PARENT_DOCUMENT].sort());
    expect(
      (await page(database, { processingState: "excepted" })).documents.map((row) => row.id),
    ).toEqual([undated]);
  });

  it("filters by exception code and returns a document with two reasons exactly once", async () => {
    const { database, raw } = migratedDatabase();
    const { undated } = widenCorpus(raw);
    const encrypted = await page(database, { exceptionCode: "encrypted" });
    expect(encrypted.documents.map((row) => row.id)).toEqual([undated]);
    // The document also carries `oversize`. A join instead of a semi-join would return it twice here
    // and make the page size mean nothing.
    const oversize = await page(database, { exceptionCode: "oversize" });
    expect(oversize.documents.map((row) => row.id)).toEqual([undated]);
    expect((await page(database, { exceptionCode: "corrupt" })).documents).toEqual([]);
  });

  it("reports no next cursor when the page is exactly the last of the corpus", async () => {
    const { database } = migratedDatabase();
    // Three documents, a page of three: a cursor here would send a caller round again for nothing.
    const result = await readReviewDocumentPage(
      database,
      REVIEW_SET,
      reviewerAccess,
      {},
      undefined,
      3,
    );
    expect(result.documents).toHaveLength(3);
    expect(result.nextCursor).toBeNull();
  });
});

describe("the exception read", () => {
  it("counts by code over the reviewer's corpus and never the walled one", async () => {
    const { database, raw } = migratedDatabase();
    widenCorpus(raw);
    const counts = await readVisibleExceptionCounts(database, REVIEW_SET, reviewerAccess);
    expect(counts).toEqual([
      { code: "encrypted", document_count: 1 },
      { code: "oversize", document_count: 1 },
    ]);
    // The walled corpus has a `corrupt` exception. Asking for it by identifier answers nothing.
    expect(await readVisibleExceptionCounts(database, WALLED_REVIEW_SET, reviewerAccess)).toEqual(
      [],
    );
  });

  it("walks the document-and-reason pair, so a page boundary inside one document drops nothing", async () => {
    const { database, raw } = migratedDatabase();
    widenCorpus(raw);
    const first = await readReviewSetExceptionPage(
      database,
      REVIEW_SET,
      reviewerAccess,
      null,
      null,
      1,
    );
    expect(first).toHaveLength(1);
    const second = await readReviewSetExceptionPage(
      database,
      REVIEW_SET,
      reviewerAccess,
      first[0]!.review_document_id,
      first[0]!.exception_id,
      1,
    );
    // The SAME document's second reason, not the next document. Resuming from the document alone
    // would skip it, and a dropped reason reads as a document that had no trouble.
    expect(second).toHaveLength(1);
    expect(second[0]!.review_document_id).toBe(first[0]!.review_document_id);
    expect(second[0]!.code).not.toBe(first[0]!.code);
  });

  it("returns nothing to a member off the list", async () => {
    const { database, raw } = migratedDatabase();
    widenCorpus(raw);
    expect(
      await readReviewSetExceptionPage(database, REVIEW_SET, outsiderAccess, null, null, 50),
    ).toEqual([]);
  });
});

describe("the occurrence read", () => {
  it("names every other record custodian who held the document, and refuses the walled corpus", async () => {
    const { database, raw } = migratedDatabase();
    widenCorpus(raw);
    raw.exec(
      `INSERT INTO review_document_occurrence (id, review_set_id, primary_review_document_id, ` +
        `duplicate_review_document_id, record_custodian_id, discovery_load_id, created_at) VALUES ` +
        `('reviewDocumentOccurrence_one000000000', '${REVIEW_SET}', '${PARENT_DOCUMENT}', ` +
        `'${STANDALONE_DOCUMENT}', '${OTHER_CUSTODIAN}', '${SECOND_LOAD}', '${INSTANT}')`,
    );
    const occurrences = await readVisibleOccurrences(
      database,
      REVIEW_SET,
      PARENT_DOCUMENT,
      reviewerAccess,
      50,
    );
    expect(occurrences.data).toHaveLength(1);
    expect(occurrences.data[0]?.record_custodian_id).toBe(OTHER_CUSTODIAN);
    expect(occurrences.data[0]?.duplicate_review_document_id).toBe(STANDALONE_DOCUMENT);

    expect(
      (await readVisibleOccurrences(database, REVIEW_SET, PARENT_DOCUMENT, outsiderAccess, 50))
        .data,
    ).toEqual([]);
  });

  it("returns the primary's own record custodian nowhere — an occurrence is about the copies", async () => {
    const { database } = migratedDatabase();
    const occurrences = await readVisibleOccurrences(
      database,
      REVIEW_SET,
      PARENT_DOCUMENT,
      reviewerAccess,
      50,
    );
    expect(occurrences.data).toEqual([]);
    expect(RECORD_CUSTODIAN).toBeDefined();
  });
});

// The keyset walks. Each proves the same two things the campaign is about: the page order is the
// ordering the read claims, and walking the cursor reaches every row exactly once. Bounded loops, so
// a cursor that fails to advance fails the test instead of spinning in it.

describe("the discovery reads walk their pages", () => {
  it("reaches every Custodian of Record, alphabetically, two at a time", async () => {
    const { database, raw } = migratedDatabase();
    const names = ["Almond", "Birch", "Cedar", "Damson"];
    names.forEach((name, index) => {
      raw.exec(
        `INSERT INTO record_custodian (id, review_set_id, display_name, kind, created_at, ` +
          `updated_at) VALUES ('recordCustodian_walk${String(index).padStart(15, "0")}', ` +
          `'${REVIEW_SET}', '${name}', 'person', '${INSTANT}', '${INSTANT}')`,
      );
    });

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const result = await readRecordCustodians(database, REVIEW_SET, 2, cursor);
      seen.push(...result.data.map((row) => row.display_name));
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
    // The seeded record custodian sorts among them rather than beside them, so the walk proves the
    // ORDER and not merely that the four inserted rows came back.
    expect(seen).toEqual([...seen].toSorted((left, right) => left.localeCompare(right)));
    expect(seen.filter((name) => names.includes(name))).toEqual(names);
  });

  it("reaches every copy of a document, one page at a time", async () => {
    const { database, raw } = migratedDatabase();
    // Both copies live in THIS corpus. A walled document as a duplicate would pass the access
    // predicate on the occurrence row's own review_set_id and read as an ordinary fixture, which is
    // exactly the confusion this file exists to avoid.
    const duplicates = [ATTACHMENT_DOCUMENT, STANDALONE_DOCUMENT];
    duplicates.forEach((duplicate, index) => {
      raw.exec(
        `INSERT INTO review_document_occurrence (id, review_set_id, primary_review_document_id, ` +
          `duplicate_review_document_id, record_custodian_id, discovery_load_id, created_at) ` +
          `VALUES ('reviewDocumentOccurrence_walk${String(index).padStart(8, "0")}', ` +
          `'${REVIEW_SET}', '${PARENT_DOCUMENT}', '${duplicate}', '${RECORD_CUSTODIAN}', ` +
          `'${LOAD}', '${INSTANT}')`,
      );
    });

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 4; page += 1) {
      const result = await readVisibleOccurrences(
        database,
        REVIEW_SET,
        PARENT_DOCUMENT,
        reviewerAccess,
        1,
        cursor,
      );
      seen.push(...result.data.map((row) => row.duplicate_review_document_id));
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
    expect(seen).toEqual([...duplicates].toSorted((left, right) => left.localeCompare(right)));
  });
});
