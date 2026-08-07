import { describe, expect, it } from "vitest";
import type { FileId, MatterId } from "@magna-carta/identifiers/types";
import {
  DECLARED_METADATA_FIELDS,
  RESERVED_OBJECT_CLASSES,
  WORKING_DOCUMENT_OBJECT_CLASS,
  feedObjectKey,
  feedObjectMetadata,
  matterOfFeedObjectKey,
  matterScopedFilter,
} from "./filter-construction.ts";

const MATTER = "matter_wallprobe0000000000000a" as MatterId;
const OTHER_MATTER = "matter_wallprobe0000000000000b" as MatterId;
const DOCUMENT = "file_wallprobea000000000000001" as FileId;

// These literals are pinned contracts. The serialized filter is exactly what the retrieval route will
// send to the live service, and the feed key layout is a compatibility contract with every fed object
// in every firm's bucket — the same discipline as the split-key fixtures in split.test.ts. A change
// here must be argued as a re-feed of every firm's index, not made as an edit.

describe("the matter-scoped filter", () => {
  it("serializes to exactly two equality conditions, byte-pinned", () => {
    expect(JSON.stringify(matterScopedFilter(MATTER))).toBe(
      '{"matter":{"$eq":"matter_wallprobe0000000000000a"},' +
        '"object_class":{"$eq":"working-document"}}',
    );
  });

  it("carries the matter handle verbatim and nothing derived from it", () => {
    const filter = matterScopedFilter(MATTER);
    expect(filter.matter?.$eq).toBe(MATTER);
    expect(filter.matter?.$eq).not.toBe(OTHER_MATTER);
  });

  it("uses only fields the declared schema names", () => {
    const declared = new Set<string>(DECLARED_METADATA_FIELDS);
    for (const field of Object.keys(matterScopedFilter(MATTER))) {
      expect(declared.has(field)).toBe(true);
    }
  });

  it("always scopes to the working-document class — the reserved classes are excluded before any object of them exists", () => {
    const filter = matterScopedFilter(MATTER);
    expect(filter.object_class?.$eq).toBe(WORKING_DOCUMENT_OBJECT_CLASS);
    for (const reserved of RESERVED_OBJECT_CLASSES) {
      expect(filter.object_class?.$eq).not.toBe(reserved);
    }
  });
});

describe("the declared metadata schema", () => {
  it("is closed at four fields, leaving the fifth slot unallocated", () => {
    expect([...DECLARED_METADATA_FIELDS]).toEqual([
      "matter",
      "client",
      "object_class",
      "confidentiality_scope",
    ]);
  });

  it("keeps the working-document class outside the reserved list", () => {
    expect([...RESERVED_OBJECT_CLASSES]).not.toContain(WORKING_DOCUMENT_OBJECT_CLASS);
  });
});

describe("the feed-object key layout", () => {
  it("is byte-pinned: ai-search/{matter}/{file}/{version}.md", () => {
    expect(feedObjectKey(MATTER, DOCUMENT, 3)).toBe(
      "ai-search/matter_wallprobe0000000000000a/file_wallprobea000000000000001/3.md",
    );
  });

  it("round-trips the matter, which is how every hit's pointer is attributed", () => {
    expect(matterOfFeedObjectKey(feedObjectKey(MATTER, DOCUMENT, 1))).toBe(MATTER);
  });

  it("refuses to attribute a key that is not a feed key", () => {
    expect(matterOfFeedObjectKey(`files/${DOCUMENT}/1`)).toBeUndefined();
    expect(matterOfFeedObjectKey(`search/${MATTER}/splits/abc.split`)).toBeUndefined();
    expect(matterOfFeedObjectKey(`ai-search/${MATTER}/${DOCUMENT}/1.md/extra`)).toBeUndefined();
    expect(matterOfFeedObjectKey("ai-search/not-a-matter-handle/file/1.md")).toBeUndefined();
    expect(matterOfFeedObjectKey("")).toBeUndefined();
  });
});

describe("the stamped feed metadata", () => {
  it("stamps exactly the four declared fields", () => {
    const metadata = feedObjectMetadata(MATTER, "client_wallprobealpha");
    expect(Object.keys(metadata).toSorted()).toEqual([...DECLARED_METADATA_FIELDS].toSorted());
  });

  it("always stamps the working-document class and an empty confidentiality scope", () => {
    const metadata = feedObjectMetadata(MATTER, "client_wallprobealpha");
    expect(metadata.object_class).toBe(WORKING_DOCUMENT_OBJECT_CLASS);
    expect(metadata.confidentiality_scope).toBe("");
  });
});
