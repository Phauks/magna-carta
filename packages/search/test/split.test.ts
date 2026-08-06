import { describe, expect, it } from "vitest";
import { isIdentifier } from "@magna-carta/identifiers/validate";
import type { FileId, MatterId } from "@magna-carta/identifiers/types";
import { corpusOfMatter } from "../src/corpus.ts";
import {
  corpusSplitPrefix,
  splitIdentifierForDocumentVersion,
  splitObjectKey,
} from "../src/split.ts";

const MATTER = "matter_test0000000000000000001" as MatterId;
const OTHER_MATTER = "matter_test0000000000000000002" as MatterId;
const DOCUMENT = "file_test00000000000000000001" as FileId;
const OTHER_DOCUMENT = "file_test00000000000000000002" as FileId;

const CORPUS = corpusOfMatter(MATTER);
const OTHER_CORPUS = corpusOfMatter(OTHER_MATTER);

describe("split identity", () => {
  it("derives the same split id for the same document version, every time", async () => {
    const first = await splitIdentifierForDocumentVersion(DOCUMENT, 1);
    const second = await splitIdentifierForDocumentVersion(DOCUMENT, 1);
    expect(second).toBe(first);
    expect(isIdentifier(first, "indexSplit")).toBe(true);
  });

  it("derives a different split id per version and per document", async () => {
    const version1 = await splitIdentifierForDocumentVersion(DOCUMENT, 1);
    const version2 = await splitIdentifierForDocumentVersion(DOCUMENT, 2);
    const otherDocument = await splitIdentifierForDocumentVersion(OTHER_DOCUMENT, 1);
    expect(new Set([version1, version2, otherDocument]).size).toBe(3);
  });

  it("puts a split under its own corpus's prefix", async () => {
    const splitId = await splitIdentifierForDocumentVersion(DOCUMENT, 1);
    const key = splitObjectKey(CORPUS, splitId);
    expect(key).toBe(`search/${MATTER}/splits/${splitId}.split`);
    expect(key.startsWith(corpusSplitPrefix(CORPUS))).toBe(true);
    expect(key.startsWith(corpusSplitPrefix(OTHER_CORPUS))).toBe(false);
  });

  it("resolves the same document version to one key, so a retry overwrites rather than duplicates", async () => {
    const attempt1 = splitObjectKey(CORPUS, await splitIdentifierForDocumentVersion(DOCUMENT, 3));
    const attempt2 = splitObjectKey(CORPUS, await splitIdentifierForDocumentVersion(DOCUMENT, 3));
    expect(attempt2).toBe(attempt1);
  });
});

// A split's R2 key is DERIVED on every read and every write, never stored and looked up, so the exact
// bytes this derivation produces are a compatibility contract with every object already in a firm's
// bucket: change them and every published split becomes unreachable while its catalog row still claims
// it exists — a silently empty search, not a loud failure. These literals are the fixture that pins the
// contract. They are transcribed from the derivation as it stood before the scope key was widened from a
// matter to a corpus, so this file is the proof that the widening moved nothing.
//
// If a change here is ever genuinely wanted, these expectations are the place it has to be argued: it is
// a rewrite of every object in every firm's bucket plus a catalog migration, not an edit.
const PINNED_MATTER_SCOPED_KEYS: readonly { readonly version: number; readonly key: string }[] = [
  {
    version: 1,
    key: "search/matter_test0000000000000000001/splits/indexSplit_qoLiL0aNMwtY9rXQxao7y.split",
  },
  {
    version: 2,
    key: "search/matter_test0000000000000000001/splits/indexSplit_Iy4YbXJKawAdQittx1T19.split",
  },
  {
    version: 7,
    key: "search/matter_test0000000000000000001/splits/indexSplit_DuLGcE-o79Dvm0PytHv5t.split",
  },
];

describe("derived split keys are byte-identical to the keys already published", () => {
  it("derives exactly the pinned key for a matter-scoped document version", async () => {
    const derived = await Promise.all(
      PINNED_MATTER_SCOPED_KEYS.map(async (pinned) =>
        splitObjectKey(
          corpusOfMatter(MATTER),
          await splitIdentifierForDocumentVersion(DOCUMENT, pinned.version),
        ),
      ),
    );
    expect(derived).toEqual(PINNED_MATTER_SCOPED_KEYS.map((pinned) => pinned.key));
  });

  it("derives exactly the pinned prefix a query lists a matter's splits under", () => {
    expect(corpusSplitPrefix(corpusOfMatter(MATTER))).toBe(
      "search/matter_test0000000000000000001/splits/",
    );
  });

  it("keeps every pinned key under the pinned prefix, so a prefix list still finds them", () => {
    const prefix = corpusSplitPrefix(corpusOfMatter(MATTER));
    for (const pinned of PINNED_MATTER_SCOPED_KEYS) {
      expect(pinned.key.startsWith(prefix)).toBe(true);
    }
  });
});
