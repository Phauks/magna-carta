/*
 * The reviewer's two registries, and the rule that decides what a reader is shown.
 *
 * The rendition assertions are the ones that matter most. A document that could not be read still
 * has to render as SOMETHING a reviewer can act on — the named reason — because a blank pane says
 * the platform lost it, and "we produced everything we could read" is a claim a firm makes about
 * documents it can still account for. The order those rules are applied in is the reviewer's own
 * order of questions, and getting it backwards would show salvaged text from a document whose real
 * answer is that it is encrypted.
 */
import { describe, expect, it } from "vitest";
import {
  assertReviewPanels,
  panelIsBuilt,
  reviewPanels,
  type ReviewPanel,
} from "../src/lib/discovery/review-panels.ts";
import { renditionFor, SOON_RENDITIONS } from "../src/lib/discovery/renditions.ts";
import type { ReviewDocumentDetail } from "../src/lib/discovery/discovery-api.ts";

// The three built panels take components; the registry is plain data otherwise, so a stand-in is
// enough to enumerate it without mounting anything.
const stub = (() => null) as unknown as Parameters<typeof reviewPanels>[0]["facts"];
const panels: readonly ReviewPanel[] = reviewPanels({
  facts: stub,
  family: stub,
  occurrences: stub,
});

function document(overrides: Partial<ReviewDocumentDetail>): ReviewDocumentDetail {
  return {
    id: "reviewDocument_1",
    reviewSetId: "reviewSet_1",
    recordCustodianId: "recordCustodian_1",
    discoveryLoadId: "discoveryLoad_1",
    sourceKind: "file_version",
    familyId: "reviewDocument_1",
    familyRole: "standalone",
    familySequence: 0,
    sourceName: "letter.pdf",
    sourcePath: null,
    sizeBytes: 1024,
    pageCount: 2,
    formatIdentified: "application/pdf",
    sortDate: null,
    sortDateSource: null,
    processingState: "processed",
    processingDeferredReason: null,
    indexState: "deferred",
    isDedupPrimary: true,
    dedupGroupId: null,
    extractionRoute: "engine",
    pagesRecognized: null,
    contentSha256: null,
    contentMd5: null,
    contentSha1: null,
    textFingerprint: null,
    hasExtractedText: true,
    createdAt: "2026-09-01T00:00:00.000Z",
    exceptions: [],
    ...overrides,
  };
}

describe("the panel registry", () => {
  it("accepts its own declarations", () => {
    expect(() => assertReviewPanels(panels)).not.toThrow();
  });

  it("has the three reading panels built and every writing one still to come", () => {
    expect(panels.filter(panelIsBuilt).map((panel) => panel.id)).toEqual([
      "facts",
      "family",
      "occurrences",
    ]);
    // Nothing that writes is built yet, and that is the honest state: coding, privilege and
    // redaction are the review workflow's own sub-slices.
    expect(panels.filter(panelIsBuilt).every((panel) => !panel.writes)).toBe(true);
  });

  it("gives every unbuilt panel a dependency to show", () => {
    for (const panel of panels) {
      if (panelIsBuilt(panel)) continue;
      expect(panel.waitsOn.trim()).not.toBe("");
    }
  });

  it("refuses two panels sharing an id", () => {
    const one = panels[0]!;
    expect(() => assertReviewPanels([one, one])).toThrow(/declare the id/u);
  });

  it("refuses a panel that cannot say why it is empty", () => {
    expect(() =>
      assertReviewPanels([{ ...panels[0]!, id: "nameless", permission: "" } as ReviewPanel]),
    ).toThrow(/names no permission/u);
  });

  it("names a permission on every panel, including the reading ones", () => {
    for (const panel of panels) expect(panel.permission).toMatch(/^discovery:/u);
  });
});

describe("choosing how a document is shown", () => {
  it("leads with the reason when a document could not be read", () => {
    const rendition = renditionFor(document({ processingState: "excepted" }));
    expect(rendition.kind).toBe("unreadable");
    expect(rendition.explains).toContain("exception report");
  });

  it("leads with the reason even when some text was salvaged", () => {
    // The reason is what a person has to act on; showing salvaged text first would present a
    // document as readable when the corpus records that it is not.
    expect(
      renditionFor(document({ processingState: "excepted", hasExtractedText: true })).kind,
    ).toBe("unreadable");
  });

  it("says a document is not read yet rather than unreadable while it is still pending", () => {
    expect(
      renditionFor(document({ processingState: "pending", hasExtractedText: false })).kind,
    ).toBe("not-read-yet");
    expect(
      renditionFor(document({ processingState: "processing", hasExtractedText: false })).kind,
    ).toBe("not-read-yet");
  });

  it("says a read document with no text yielded none, which is an outcome and not a gap", () => {
    const rendition = renditionFor(document({ hasExtractedText: false }));
    expect(rendition.kind).toBe("unreadable");
    expect(rendition.label).toBe("No text");
  });

  it("shows the extracted text for a document that was read", () => {
    const rendition = renditionFor(document({}));
    expect(rendition.kind).toBe("extracted-text");
    // Naming what the text IS matters: it is the same text the corpus indexed and fingerprinted, so
    // coding from it is coding from what the corpus says the document contains.
    expect(rendition.explains).toContain("indexed");
  });

  it("names the ways of showing a document that are designed and not built", () => {
    expect(SOON_RENDITIONS.map((one) => one.id)).toEqual(["native", "pages", "recognized-overlay"]);
    for (const soon of SOON_RENDITIONS) expect(soon.waitsOn.trim()).not.toBe("");
  });
});
