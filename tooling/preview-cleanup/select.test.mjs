import { describe, expect, it } from "vitest";
import { KEEP, previewsToDelete, workerName } from "./select.mjs";

describe("previewsToDelete", () => {
  it("deletes every Preview except the kept one", () => {
    const previews = [{ name: KEEP }, { name: "claude-fix-thing" }, { name: "feature-x" }];
    expect(previewsToDelete(previews).map((preview) => preview.name)).toEqual([
      "claude-fix-thing",
      "feature-x",
    ]);
  });

  it("deletes nothing when the kept Preview is absent, rather than guessing", () => {
    expect(previewsToDelete([{ name: "claude-fix-thing" }, { name: "feature-x" }])).toEqual([]);
  });

  it("deletes nothing when there are no Previews", () => {
    expect(previewsToDelete([])).toEqual([]);
  });
});

describe("workerName", () => {
  it("reads the top-level name and ignores a binding's nested name", () => {
    const source = [
      "{",
      "  // the Worker",
      '  "name": "magna-carta-scan",',
      '  "r2_buckets": [{ "binding": "FILES", "bucket_name": "files" }],',
      '  "durable_objects": { "bindings": [{',
      '    "name": "SCAN",',
      '    "class_name": "Scan"',
      "  }] }",
      "}",
    ].join("\n");
    expect(workerName(source)).toBe("magna-carta-scan");
  });

  it("is null when no top-level name is declared", () => {
    expect(workerName('{\n    "name": "nested-only"\n}')).toBeNull();
  });
});
