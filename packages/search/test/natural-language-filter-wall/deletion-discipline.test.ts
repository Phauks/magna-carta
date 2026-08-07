import { describe, expect, it } from "vitest";
import { matterOfFeedObjectKey, matterScopedFilter } from "./filter-construction.ts";
import {
  FeedCatalog,
  reassignmentPlan,
  reconcileCatalogAgainstListing,
} from "./feed-catalog-discipline.ts";
import { deletionIgnoringIndex, referenceIndexOver } from "./reference-engine.ts";
import { PROBE_MATCH_THRESHOLD, PROBE_MAX_RESULTS } from "./protocol.ts";
import { generateSyntheticCorpus, type SyntheticDocument } from "./synthetic-corpus.ts";

// The delete/re-index discipline, proven at the only layer this environment can prove it: our side.
// The managed index is stale between syncs by design, so a removed document's index entry can outlive
// its removal — the discipline that keeps that residue from ever reaching a caller is (1) deletion
// planned from the catalog, (2) reassignment as delete-plus-write, (3) reconciliation that reports
// disagreement loudly, and (4) hits without a live catalog row dropped before hydration. How long the
// live service actually takes to stop returning a deleted object is a measurement only the live run
// can make; nothing here claims it.

const CORPUS = generateSyntheticCorpus({ documentsPerLargeMatter: 40 });

function catalogOver(documents: readonly SyntheticDocument[]): FeedCatalog {
  const catalog = new FeedCatalog();
  let fedAt = 1;
  for (const document of documents) {
    catalog.recordFed({
      fileId: document.fileId,
      version: document.version,
      matter: document.metadata.matter,
      objectKey: document.objectKey,
      byteCount: document.text.length,
      fedAt,
    });
    fedAt += 1;
  }
  return catalog;
}

describe("catalog-driven deletion", () => {
  it("plans a matter's deletion from catalog rows, never from a listing", () => {
    const catalog = catalogOver(CORPUS.documents);
    const plan = catalog.deletionPlanForMatter(CORPUS.matterB);
    const matterBKeys = CORPUS.documentsOfMatter(CORPUS.matterB).map(
      (document) => document.objectKey,
    );
    expect(plan.toSorted()).toEqual(matterBKeys.toSorted());
    for (const objectKey of plan) {
      expect(matterOfFeedObjectKey(objectKey)).toBe(CORPUS.matterB);
    }
  });

  it("excludes already-removed rows from a later plan, so a re-run converges instead of re-deleting", () => {
    const catalog = catalogOver(CORPUS.documents);
    const [first] = CORPUS.documentsOfMatter(CORPUS.matterB);
    expect(first).toBeDefined();
    if (first === undefined) return;
    catalog.markRemoved(first.fileId, first.version, 100);
    expect(catalog.deletionPlanForMatter(CORPUS.matterB)).not.toContain(first.objectKey);
  });

  it("enumeration proves the state: every row carries its removal timestamp", () => {
    const catalog = catalogOver(CORPUS.documents);
    const [first] = CORPUS.documentsOfMatter(CORPUS.matterB);
    expect(first).toBeDefined();
    if (first === undefined) return;
    catalog.markRemoved(first.fileId, first.version, 100);
    const removed = catalog.allRows().filter((row) => row.removedAt !== undefined);
    expect(removed).toHaveLength(1);
    expect(removed[0]?.objectKey).toBe(first.objectKey);
    expect(removed[0]?.removedAt).toBe(100);
  });
});

describe("reconciliation between catalog and bucket", () => {
  it("is consistent when every live row has its object and every object its live row", () => {
    const catalog = catalogOver(CORPUS.documents);
    const listing = CORPUS.documents.map((document) => document.objectKey);
    expect(reconcileCatalogAgainstListing(catalog, listing).consistent).toBe(true);
  });

  it("reports an object the catalog does not know about — never sweeps it along silently", () => {
    const catalog = catalogOver(CORPUS.documents);
    const strayKey = `ai-search/${CORPUS.matterA}/file_wallprobestray0000000001/1.md`;
    const listing = [...CORPUS.documents.map((document) => document.objectKey), strayKey];
    const report = reconcileCatalogAgainstListing(catalog, listing);
    expect(report.consistent).toBe(false);
    expect(report.objectsWithoutLiveRow).toEqual([strayKey]);
  });

  it("reports a live row whose object is gone", () => {
    const catalog = catalogOver(CORPUS.documents);
    const [first, ...rest] = CORPUS.documents.map((document) => document.objectKey);
    expect(first).toBeDefined();
    const report = reconcileCatalogAgainstListing(catalog, rest);
    expect(report.consistent).toBe(false);
    expect(report.liveRowsWithoutObject).toEqual([first]);
  });

  it("treats a recorded-but-unexecuted delete as an inconsistency, not a success", () => {
    const catalog = catalogOver(CORPUS.documents);
    const [first] = CORPUS.documentsOfMatter(CORPUS.matterB);
    expect(first).toBeDefined();
    if (first === undefined) return;
    catalog.markRemoved(first.fileId, first.version, 100);
    // The object is still in the bucket: the delete was recorded but never executed.
    const listing = CORPUS.documents.map((document) => document.objectKey);
    const report = reconcileCatalogAgainstListing(catalog, listing);
    expect(report.consistent).toBe(false);
    expect(report.objectsWithoutLiveRow).toEqual([first.objectKey]);
  });
});

describe("matter reassignment", () => {
  it("moves the feed copy as delete-old-key plus write-new-key", () => {
    const catalog = catalogOver(CORPUS.documents);
    const row = catalog.liveRows().find((candidate) => candidate.matter === CORPUS.matterB);
    expect(row).toBeDefined();
    if (row === undefined) return;
    const plan = reassignmentPlan(row, CORPUS.matterA);
    expect(plan.deleteObjectKey).toBe(row.objectKey);
    expect(plan.writeObjectKey).toBe(`ai-search/${CORPUS.matterA}/${row.fileId}/${row.version}.md`);
    expect(matterOfFeedObjectKey(plan.writeObjectKey)).toBe(CORPUS.matterA);
  });
});

describe("residue between removal and sync", () => {
  const removedDocument = CORPUS.documentsOfMatter(CORPUS.matterB)[3];

  function scopedQuery(text: string) {
    return {
      query: text,
      filters: matterScopedFilter(CORPUS.matterB),
      maxNumResults: PROBE_MAX_RESULTS,
      matchThreshold: PROBE_MATCH_THRESHOLD,
    };
  }

  it("a removed document keeps surfacing until the next sync, and stops after it", async () => {
    expect(removedDocument).toBeDefined();
    if (removedDocument === undefined) return;
    const index = referenceIndexOver(CORPUS.documents);
    index.delete(removedDocument.objectKey);

    const beforeSync = await index.search(scopedQuery(removedDocument.verbatimPassage));
    expect(beforeSync.ok).toBe(true);
    if (!beforeSync.ok) return;
    expect(beforeSync.hits.some((hit) => hit.objectKey === removedDocument.objectKey)).toBe(true);

    index.sync();
    const afterSync = await index.search(scopedQuery(removedDocument.verbatimPassage));
    expect(afterSync.ok).toBe(true);
    if (!afterSync.ok) return;
    expect(afterSync.hits.some((hit) => hit.objectKey === removedDocument.objectKey)).toBe(false);
  });

  it("the catalog check drops a residue hit before hydration, so a caller never sees it — even against an index whose deletes never land", async () => {
    expect(removedDocument).toBeDefined();
    if (removedDocument === undefined) return;
    const index = deletionIgnoringIndex(CORPUS.documents);
    const catalog = catalogOver(CORPUS.documents);
    catalog.markRemoved(removedDocument.fileId, removedDocument.version, 100);
    index.delete(removedDocument.objectKey);
    index.sync();

    const result = await index.search(scopedQuery(removedDocument.verbatimPassage));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The broken index still returns the removed document…
    expect(result.hits.some((hit) => hit.objectKey === removedDocument.objectKey)).toBe(true);
    // …and the survivor step — only hits with a live catalog row are hydrated — removes it.
    const survivors = result.hits.filter(
      (hit) => catalog.liveRowForObjectKey(hit.objectKey) !== undefined,
    );
    expect(survivors.some((hit) => hit.objectKey === removedDocument.objectKey)).toBe(false);
    expect(survivors.length).toBe(result.hits.length - 1);
  });
});
