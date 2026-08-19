import { describe, expect, it } from "vitest";
import { isIdentifier } from "@magna-carta/identifiers/validate";
import type { MatterId, ReviewDocumentId, ReviewSetId } from "@magna-carta/identifiers/types";
import { corpusOfMatter, corpusOfReviewSet } from "../src/corpus.ts";
import {
  corpusSplitPrefix,
  splitIdentifierForCompaction,
  splitIdentifierForDocumentVersion,
  splitIdentifierForReviewDocument,
  splitObjectKey,
} from "../src/split.ts";

// A matter's corpus and a review set's are two indexes over material that must not meet. The keys are
// where that starts: everything downstream — the catalog, the query, the wholesale deletion — is scoped
// by the corpus, so if two corpora could ever agree on a key nothing further down could tell them
// apart.

const MATTER = "matter_test0000000000000000001" as MatterId;
const REVIEW_SET = "reviewSet_test000000000000000001" as ReviewSetId;
const REVIEW_DOCUMENT = "reviewDocument_test00000000000001" as ReviewDocumentId;

describe("the two corpus kinds", () => {
  it("maps a review set to its own corpus and not to the matter it sits on", () => {
    const corpus = corpusOfReviewSet(REVIEW_SET);
    expect(corpus).toEqual({ kind: "reviewSet", id: REVIEW_SET });
    // The material an opposing party produced is reachable through the review set and through nothing
    // else. A corpus that resolved to the matter would put it in the matter's own search.
    expect(String(corpus.id)).not.toBe(String(MATTER));
  });

  it("puts the two corpora under disjoint object prefixes", () => {
    const matterPrefix = corpusSplitPrefix(corpusOfMatter(MATTER));
    const reviewSetPrefix = corpusSplitPrefix(corpusOfReviewSet(REVIEW_SET));
    expect(matterPrefix).not.toBe(reviewSetPrefix);
    // Disjoint, not merely different: neither is a prefix of the other, so a prefix LIST of one can
    // never enumerate an object belonging to the other.
    expect(matterPrefix.startsWith(reviewSetPrefix)).toBe(false);
    expect(reviewSetPrefix.startsWith(matterPrefix)).toBe(false);
  });

  it("leaves the matter corpus's derived prefix byte-identical to what it always was", () => {
    // The pinned keys in split.test.ts say the same thing for a whole key; this says it for the
    // prefix a query lists under, because adding a second corpus kind must move nothing published.
    expect(corpusSplitPrefix(corpusOfMatter(MATTER))).toBe(
      "search/matter_test0000000000000000001/splits/",
    );
  });
});

describe("a review document's split identity", () => {
  it("derives the same id every time, so a replay overwrites its own object", async () => {
    const first = await splitIdentifierForReviewDocument(REVIEW_DOCUMENT);
    const second = await splitIdentifierForReviewDocument(REVIEW_DOCUMENT);
    expect(second).toBe(first);
    expect(isIdentifier(first, "indexSplit")).toBe(true);
  });

  it("is not the id a file of the same handle text would derive", async () => {
    // The two derivations are in the same namespace, so the domain word in the hash is what keeps a
    // review document and a file version from ever colliding on one split.
    const reviewDocument = await splitIdentifierForReviewDocument(REVIEW_DOCUMENT);
    const asDocumentVersion = await splitIdentifierForDocumentVersion(
      REVIEW_DOCUMENT as unknown as Parameters<typeof splitIdentifierForDocumentVersion>[0],
      1,
    );
    expect(reviewDocument).not.toBe(asDocumentVersion);
  });

  it("lands under its review set's prefix and never under the matter's", async () => {
    const splitId = await splitIdentifierForReviewDocument(REVIEW_DOCUMENT);
    const key = splitObjectKey(corpusOfReviewSet(REVIEW_SET), splitId);
    expect(key).toBe(`search/${REVIEW_SET}/splits/${splitId}.split`);
    expect(key.startsWith(corpusSplitPrefix(corpusOfMatter(MATTER)))).toBe(false);
  });
});

describe("a compacted split belongs to one corpus", () => {
  it("derives different ids for the same source set merged in two corpora", async () => {
    const sources = await Promise.all([
      splitIdentifierForReviewDocument(REVIEW_DOCUMENT),
      splitIdentifierForDocumentVersion(
        "file_test00000000000000000001" as Parameters<typeof splitIdentifierForDocumentVersion>[0],
        1,
      ),
    ]);
    const inMatter = await splitIdentifierForCompaction(corpusOfMatter(MATTER), sources);
    const inReviewSet = await splitIdentifierForCompaction(corpusOfReviewSet(REVIEW_SET), sources);
    // Two corpora that happened to merge splits with the same ids are different splits and must not
    // overwrite each other's bytes.
    expect(inMatter).not.toBe(inReviewSet);
  });
});
