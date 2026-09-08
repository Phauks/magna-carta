/*
 * The workbench's file list: the columns it is read and sorted by, and the verbs one row carries.
 *
 * Both are values rather than markup, which is the point — what a column sorts on and when a verb
 * is refused are decisions, and a decision that can only be checked by clicking is a decision
 * nobody checks.
 */
import { describe, expect, it } from "vitest";
import { RAIL_COLUMNS, railColumns } from "../src/lib/tools/file-workbench/rail-columns.ts";
import { clipboardTextFor, rowMenuItems } from "../src/lib/tools/file-workbench/row-menu.ts";
import { identifyFromPrefix } from "../src/lib/tools/file-workbench/identify.ts";
import { HASH_CAPABILITY } from "../src/lib/tools/file-workbench/capabilities/hash.ts";
import {
  FILE_TYPE_CAPABILITY,
  type CapabilityOutcome,
  type WorkbenchFile,
} from "../src/lib/tools/file-workbench/workbench-file.ts";

const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);

function fileNamed(name: string, options: { hashed?: boolean } = {}): WorkbenchFile {
  const outcomes: Record<string, CapabilityOutcome<unknown>> = {
    [FILE_TYPE_CAPABILITY]: {
      kind: "result",
      value: identifyFromPrefix(ascii("%PDF-1.7\n"), name),
    },
  };
  if (options.hashed === true) {
    outcomes[HASH_CAPABILITY] = {
      kind: "result",
      value: { "SHA-256": "9f2c1d8b", "SHA-1": "3ab19c7e" },
    };
  }
  return {
    id: `test-${name}`,
    name,
    sizeBytes: 2048,
    declaredMediaType: "application/pdf",
    receivedAt: new Date("2026-08-31T12:00:00Z"),
    preview: { kind: "none", reason: "a fixture draws nothing" },
    readBytes: () => Promise.resolve(new Uint8Array(0)),
    outcomes,
  };
}

describe("the columns the list is read by", () => {
  const columns = railColumns();
  const byId = (id: string) => columns.find((column) => column.id === id);

  it("offers every field the list is sorted by", () => {
    expect(columns.map((column) => column.id)).toEqual([
      RAIL_COLUMNS.name,
      RAIL_COLUMNS.type,
      RAIL_COLUMNS.size,
      RAIL_COLUMNS.added,
      RAIL_COLUMNS.safety,
      RAIL_COLUMNS.actions,
    ]);
  });

  it("sorts size as a number and arrival as a date, not as text", () => {
    // Sorted as text, 94 bytes would come after 2.1 KB and nobody could find the big file.
    expect(byId(RAIL_COLUMNS.size)?.type).toBe("number");
    expect(byId(RAIL_COLUMNS.added)?.type).toBe("date");
  });

  it("shows the size in words while sorting on the byte count", () => {
    const size = byId(RAIL_COLUMNS.size);
    const file = fileNamed("Deposition.pdf");
    expect(size?.value(file)).toBe(2048);
    expect(size?.text?.(file)).toBe("2.0 KB");
  });

  it("anchors and pins the name, so it cannot scroll away from its own row", () => {
    expect(byId(RAIL_COLUMNS.name)?.anchored).toBe(true);
    expect(byId(RAIL_COLUMNS.name)?.pinned).toBe(true);
  });

  it("keeps arrival and safety off the narrow rail until they are asked for", () => {
    expect(byId(RAIL_COLUMNS.added)?.hidden).toBe(true);
    expect(byId(RAIL_COLUMNS.safety)?.hidden).toBe(true);
  });

  it("filters type and safety by the set actually present, not by typing a format name", () => {
    expect(byId(RAIL_COLUMNS.type)?.filter).toBe("set");
    expect(byId(RAIL_COLUMNS.safety)?.filter).toBe("set");
  });
});

describe("a row's own menu", () => {
  it("offers the verbs an unfiled file has, and discard last", () => {
    const items = rowMenuItems(fileNamed("Deposition.pdf", { hashed: true }));
    expect(items.map((item) => item.identifier)).toEqual([
      "copy-name",
      "copy-digest",
      "download",
      "discard",
    ]);
  });

  it("refuses to copy a digest that has not been computed, and says so", () => {
    const items = rowMenuItems(fileNamed("Deposition.pdf"));
    const digest = items.find((item) => item.identifier === "copy-digest");
    expect(digest?.disabledReason).toBeTruthy();
  });

  it("offers the digest once it exists", () => {
    const file = fileNamed("Deposition.pdf", { hashed: true });
    const items = rowMenuItems(file);
    const digest = items.find((item) => item.identifier === "copy-digest");
    expect(digest?.disabledReason).toBeUndefined();
    expect(clipboardTextFor(digest!, file)).toBe("9f2c1d8b");
  });

  it("copies the name verbatim, and nothing for a verb that copies nothing", () => {
    const file = fileNamed("Deposition.pdf", { hashed: true });
    const items = rowMenuItems(file);
    expect(clipboardTextFor(items[0]!, file)).toBe("Deposition.pdf");
    const discard = items.find((item) => item.identifier === "discard");
    expect(clipboardTextFor(discard!, file)).toBeNull();
  });
});
