import { describe, expect, it } from "vitest";
import type {
  IndexSplitId,
  MatterId,
  ReviewDocumentId,
  ReviewSetId,
} from "@magna-carta/identifiers/types";
import { freshFirmDatabase } from "./support/fresh-firm-database.ts";
import {
  countLiveSplitsForCorpus,
  countStaleMembersForCorpus,
  insertIndexSplitMemberStatement,
  insertIndexSplitStatement,
  listCorporaWithLiveSplits,
  listLiveSplitsForCorpus,
  listMattersWithLiveSplits,
  listStaleMembersForCorpus,
  markMembersStaleForDocumentStatement,
  type InsertIndexSplitRow,
} from "../src/index-split-statements.ts";

// THE DISCLOSURE PROPERTY, and the reason the catalog gained a corpus at all.
//
// A discovery review set holds material an opposing party produced, often under a protective order the
// firm's own matter team is not uniformly cleared for. Its splits live in the same table as the
// matter's, on the same matter, so the only thing keeping a matter search from enumerating them is
// which column the scope reads name. Every assertion below fails if any of them goes back to
// `matter_id` — which is what these tests are for, because that read would look completely ordinary.

const MATTER = "matter_test0000000000000000001" as MatterId;
const REVIEW_SET = "reviewSet_test000000000000000001" as ReviewSetId;
const FILE_DOCUMENT = "file_test00000000000000000001" as Parameters<
  typeof markMembersStaleForDocumentStatement
>[1];
const REVIEW_DOCUMENT = "reviewDocument_test00000000000001" as ReviewDocumentId;

// Both corpora sit on the SAME matter, deliberately: that is the real arrangement, and a test that
// used two matters would pass against a matter-keyed read.
function matterSplit(id: string, createdAt: string): InsertIndexSplitRow {
  return {
    id: id as IndexSplitId,
    matterId: MATTER,
    corpusKind: "matter",
    corpusId: MATTER,
    documentId: FILE_DOCUMENT,
    version: 1,
    objectKey: `search/${MATTER}/splits/${id}.split`,
    documentCount: 10,
    sizeBytes: 1024,
    schemaGeneration: 1,
    createdAt,
  };
}

function reviewSetSplit(id: string, createdAt: string): InsertIndexSplitRow {
  return {
    id: id as IndexSplitId,
    // The review set's matter, carried as provenance exactly as the writer carries it. If any scope
    // read used this column the corpora would collapse into one.
    matterId: MATTER,
    corpusKind: "reviewSet",
    corpusId: REVIEW_SET,
    documentId: REVIEW_DOCUMENT,
    version: 1,
    objectKey: `search/${REVIEW_SET}/splits/${id}.split`,
    documentCount: 20,
    sizeBytes: 2048,
    schemaGeneration: 1,
    createdAt,
  };
}

async function seedBothCorpora() {
  const database = await freshFirmDatabase();
  await database.batch([
    insertIndexSplitStatement(
      database,
      matterSplit("indexSplit_matter00000000000000001", "2026-08-19T01:00:00.000Z"),
    ),
    insertIndexSplitStatement(
      database,
      reviewSetSplit("indexSplit_reviewSet00000000000001", "2026-08-19T02:00:00.000Z"),
    ),
  ]);
  return database;
}

describe("a query enumerates one corpus and structurally cannot name the other's splits", () => {
  it("returns only the matter's splits for the matter's corpus", async () => {
    const database = await seedBothCorpora();
    const live = await listLiveSplitsForCorpus(database, MATTER);
    expect(live.map((split) => split.id)).toEqual(["indexSplit_matter00000000000000001"]);
    // And the key it hands the engine is under the matter's own prefix, so even the object the
    // engine would range-read cannot be the review set's.
    expect(live[0]?.objectKey.startsWith(`search/${MATTER}/`)).toBe(true);
  });

  it("returns only the review set's splits for the review set's corpus", async () => {
    const database = await seedBothCorpora();
    const live = await listLiveSplitsForCorpus(database, REVIEW_SET);
    expect(live.map((split) => split.id)).toEqual(["indexSplit_reviewSet00000000000001"]);
  });

  it("counts each corpus separately, so one corpus's growth never triggers the other's compaction", async () => {
    const database = await seedBothCorpora();
    expect(await countLiveSplitsForCorpus(database, MATTER)).toBe(1);
    expect(await countLiveSplitsForCorpus(database, REVIEW_SET)).toBe(1);
  });

  it("keeps the matter's row reachable as provenance without making it a scope", async () => {
    const database = await seedBothCorpora();
    const reviewSetSplits = await listLiveSplitsForCorpus(database, REVIEW_SET);
    // The matter IS on the row — that is what stamps the object and answers "which file was this work
    // done under". It is simply never the thing enumerated by.
    expect(reviewSetSplits[0]?.matterId).toBe(MATTER);
    expect(reviewSetSplits[0]?.corpusKind).toBe("reviewSet");
    expect(reviewSetSplits[0]?.corpusId).toBe(REVIEW_SET);
  });
});

describe("the compaction backstop enumerates corpora, not matters", () => {
  it("offers both corpora on one matter as two separate candidates", async () => {
    const database = await seedBothCorpora();
    const corpora = await listCorporaWithLiveSplits(database, 10);
    expect(corpora.map((corpus) => corpus.corpusId).sort()).toEqual([MATTER, REVIEW_SET].sort());
    // Each carries the matter it was published under, which is what the merged split is stamped with.
    for (const corpus of corpora) expect(corpus.matterId).toBe(MATTER);
  });
});

describe("the matters a question across matters asks", () => {
  const EMPTY_MATTER = "matter_test0000000000000000002" as MatterId;

  it("names the matters with something indexed, and none of the others asked about", async () => {
    const database = await seedBothCorpora();
    expect(await listMattersWithLiveSplits(database, [EMPTY_MATTER, MATTER])).toEqual([MATTER]);
    expect(await listMattersWithLiveSplits(database, [EMPTY_MATTER])).toEqual([]);
    expect(await listMattersWithLiveSplits(database, [])).toEqual([]);
  });

  it("does not count a review set's splits as the matter's, though they sit on that matter", async () => {
    const database = await freshFirmDatabase();
    await insertIndexSplitStatement(
      database,
      reviewSetSplit("indexSplit_reviewSet00000000000001", "2026-08-19T02:00:00.000Z"),
    ).run();
    expect(await listMattersWithLiveSplits(database, [MATTER])).toEqual([]);
    // And a review set cannot be asked for by handing its identifier in as a matter's.
    expect(await listMattersWithLiveSplits(database, [REVIEW_SET as unknown as MatterId])).toEqual(
      [],
    );
  });
});

describe("stale members are read per corpus", () => {
  it("does not report a review set's stale members to a matter's query", async () => {
    const database = await freshFirmDatabase();
    const mergedInReviewSet = "indexSplit_mergedReviewSet0000000" as IndexSplitId;
    await database.batch([
      insertIndexSplitStatement(database, matterSplit("indexSplit_m00000000000000000001", "a")),
      insertIndexSplitStatement(database, {
        ...reviewSetSplit(mergedInReviewSet, "b"),
        documentId: null,
        version: null,
      }),
      insertIndexSplitMemberStatement(database, {
        splitId: mergedInReviewSet,
        documentId: REVIEW_DOCUMENT,
        version: 1,
      }),
      markMembersStaleForDocumentStatement(database, REVIEW_DOCUMENT, "2026-08-19T03:00:00.000Z"),
    ]);

    // The review set has one stale member inside a merged split; the matter has none. A
    // matter-keyed read would hand the matter's query an exclusion naming a review document — which
    // both leaks the identifier and is meaningless to that query.
    expect(await listStaleMembersForCorpus(database, MATTER)).toEqual([]);
    expect(await countStaleMembersForCorpus(database, MATTER)).toBe(0);
    expect(await listStaleMembersForCorpus(database, REVIEW_SET)).toEqual([
      { splitId: mergedInReviewSet, documentId: REVIEW_DOCUMENT },
    ]);
    expect(await countStaleMembersForCorpus(database, REVIEW_SET)).toBe(1);
  });
});
