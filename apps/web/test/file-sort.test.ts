/*
 * The file surface's sort model, pinned. The readers are TOTAL by contract — they parse a URL, which
 * anyone can hand-edit and which outlives the code that wrote it — so the interesting cases are the
 * junk ones: a retired column, a typo, an empty string. None may throw, and none may reach the server.
 */
import { describe, expect, it } from "vitest";
import {
  ariaSortFor,
  defaultDirectionFor,
  parseFileSortDirection,
  parseFileSortKey,
  sortAfterHeadingClick,
  type FileSort,
} from "../src/lib/files/file-sort.ts";

describe("parseFileSortKey", () => {
  it("keeps a column the server offers", () => {
    expect(parseFileSortKey("name")).toBe("name");
    expect(parseFileSortKey("sizeBytes")).toBe("sizeBytes");
    expect(parseFileSortKey("updatedAt")).toBe("updatedAt");
  });

  it("folds anything else to the default rather than sending it on", () => {
    // A column the server does not offer would be a 422; the URL must never be able to cause one.
    expect(parseFileSortKey("quarantineReason")).toBe("createdAt");
    expect(parseFileSortKey("")).toBe("createdAt");
    expect(parseFileSortKey(null)).toBe("createdAt");
  });
});

describe("parseFileSortDirection", () => {
  it("keeps a real direction and folds the rest", () => {
    expect(parseFileSortDirection("asc")).toBe("asc");
    expect(parseFileSortDirection("desc")).toBe("desc");
    expect(parseFileSortDirection("sideways")).toBe("desc");
    expect(parseFileSortDirection(null)).toBe("desc");
  });
});

describe("defaultDirectionFor", () => {
  it("reads a name A-to-Z, but a date or a size biggest-and-newest first", () => {
    // The question people actually have of a date is "what came in last", not "what is oldest".
    expect(defaultDirectionFor("name")).toBe("asc");
    expect(defaultDirectionFor("createdAt")).toBe("desc");
    expect(defaultDirectionFor("updatedAt")).toBe("desc");
    expect(defaultDirectionFor("sizeBytes")).toBe("desc");
  });
});

describe("sortAfterHeadingClick", () => {
  const byNewest: FileSort = { key: "createdAt", direction: "desc" };

  it("reverses the column already in force", () => {
    expect(sortAfterHeadingClick(byNewest, "createdAt")).toEqual({
      key: "createdAt",
      direction: "asc",
    });
    expect(sortAfterHeadingClick({ key: "name", direction: "asc" }, "name")).toEqual({
      key: "name",
      direction: "desc",
    });
  });

  it("switches to another column in ITS natural direction, so a first click is never a no-op", () => {
    expect(sortAfterHeadingClick(byNewest, "name")).toEqual({ key: "name", direction: "asc" });
    expect(sortAfterHeadingClick({ key: "name", direction: "asc" }, "sizeBytes")).toEqual({
      key: "sizeBytes",
      direction: "desc",
    });
  });
});

describe("ariaSortFor", () => {
  it("announces the column in force, and only that one", () => {
    const sort: FileSort = { key: "sizeBytes", direction: "desc" };
    expect(ariaSortFor(sort, "sizeBytes")).toBe("descending");
    expect(ariaSortFor({ key: "name", direction: "asc" }, "name")).toBe("ascending");
    expect(ariaSortFor(sort, "name")).toBe("none");
    expect(ariaSortFor(sort, "createdAt")).toBe("none");
  });
});
