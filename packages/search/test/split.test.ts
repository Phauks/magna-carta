import { describe, expect, it } from "vitest";
import { isIdentifier } from "@magna-carta/identifiers/validate";
import type { FileId, MatterId } from "@magna-carta/identifiers/types";
import {
  matterSplitPrefix,
  splitIdentifierForDocumentVersion,
  splitObjectKey,
} from "../src/split.ts";

const MATTER = "matter_test0000000000000000001" as MatterId;
const OTHER_MATTER = "matter_test0000000000000000002" as MatterId;
const DOCUMENT = "file_test00000000000000000001" as FileId;
const OTHER_DOCUMENT = "file_test00000000000000000002" as FileId;

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

  it("puts a split under its own matter's prefix", async () => {
    const splitId = await splitIdentifierForDocumentVersion(DOCUMENT, 1);
    const key = splitObjectKey(MATTER, splitId);
    expect(key).toBe(`search/${MATTER}/splits/${splitId}.split`);
    expect(key.startsWith(matterSplitPrefix(MATTER))).toBe(true);
    expect(key.startsWith(matterSplitPrefix(OTHER_MATTER))).toBe(false);
  });

  it("resolves the same document version to one key, so a retry overwrites rather than duplicates", async () => {
    const attempt1 = splitObjectKey(MATTER, await splitIdentifierForDocumentVersion(DOCUMENT, 3));
    const attempt2 = splitObjectKey(MATTER, await splitIdentifierForDocumentVersion(DOCUMENT, 3));
    expect(attempt2).toBe(attempt1);
  });
});
