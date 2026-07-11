/*
 * The file surface's preference codecs, pinned on the read path — where a stale, hand-edited, or
 * outright hostile payload arrives. `decode` is total by contract: it must fold anything back to a
 * valid value rather than throw, because a preference that throws on read takes the page down with
 * it.
 */
import { describe, expect, it } from "vitest";
import {
  FILES_REGIONS_STORAGE_KEY,
  FILES_VIEW_STORAGE_KEY,
  FOLDERS_REGION_ID,
  filesRegionsCodec,
  filesViewCodec,
} from "../src/lib/files/files-view-preference.ts";

describe("filesViewCodec", () => {
  it("keeps a registered view", () => {
    expect(filesViewCodec.decode("tiles")).toBe("tiles");
    expect(filesViewCodec.decode("gallery")).toBe("gallery");
  });

  it("falls back to the list view when nothing is stored", () => {
    expect(filesViewCodec.decode(null)).toBe("list");
  });

  it("folds a retired or hand-edited view back to the default", () => {
    expect(filesViewCodec.decode("kanban")).toBe("list");
    expect(filesViewCodec.decode("")).toBe("list");
  });

  it("round-trips through storage", () => {
    expect(filesViewCodec.decode(filesViewCodec.encode("timeline"))).toBe("timeline");
    expect(filesViewCodec.storageKey).toBe(FILES_VIEW_STORAGE_KEY);
  });
});

describe("filesRegionsCodec", () => {
  it("keeps a known region's boolean", () => {
    expect(filesRegionsCodec.decode(JSON.stringify({ [FOLDERS_REGION_ID]: false }))).toEqual({
      [FOLDERS_REGION_ID]: false,
    });
  });

  it("has no opinion when nothing is stored, so each region falls to its own default", () => {
    expect(filesRegionsCodec.decode(null)).toEqual({});
  });

  it("drops an unknown region id rather than re-seating a region that no longer exists", () => {
    expect(filesRegionsCodec.decode(JSON.stringify({ retired: true }))).toEqual({});
  });

  it("drops a non-boolean value", () => {
    expect(filesRegionsCodec.decode(JSON.stringify({ [FOLDERS_REGION_ID]: "yes" }))).toEqual({});
  });

  it("survives a payload that is not an object, and one that is not JSON at all", () => {
    expect(filesRegionsCodec.decode(JSON.stringify("folders"))).toEqual({});
    expect(filesRegionsCodec.decode("{not json")).toEqual({});
  });

  it("round-trips through storage", () => {
    const record = { [FOLDERS_REGION_ID]: true };
    expect(filesRegionsCodec.decode(filesRegionsCodec.encode(record))).toEqual(record);
    expect(filesRegionsCodec.storageKey).toBe(FILES_REGIONS_STORAGE_KEY);
  });
});
