import { describe, expect, it } from "vitest";
import { backgroundMenu, rowMenu } from "../src/lib/file-manager/file-menu-model.ts";
import type {
  FileMenuEntry,
  FileMenuFlyout,
  FileMenuItem,
} from "../src/lib/file-manager/file-menu-model.ts";
import { fileKey, folderKey, type FileManagerRow } from "../src/lib/file-manager/file-rows.ts";
import type { MatterFile } from "../src/lib/file-manager/matter-file-api.ts";

/*
 * What the right-click menu says, and — the part that keeps being got wrong — what it says over a
 * MULTIPLE selection. The rule is that the menu speaks for the whole selection: counts on the acts
 * that can take many, disabled-with-a-reason on the one-item gestures, and absent on the acts that
 * have no meaning at all over many. A disabled item is never silent.
 */

const file = (id: string, over: Partial<MatterFile> = {}): FileManagerRow => ({
  kind: "file",
  key: fileKey(id),
  file: {
    id,
    matterId: "matter",
    folderId: null,
    name: `${id}.pdf`,
    documentTypeId: "type",
    currentVersionId: "version",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    versionNumber: 1,
    sizeBytes: 10,
    sniffedContentType: "application/pdf",
    scanVerdict: "clean",
    status: "clean",
    quarantineReason: null,
    sourceModifiedAt: null,
    uploadedBy: null,
    uploadedByName: null,
    ...over,
  },
});

const folder = (id: string): FileManagerRow => ({
  kind: "folder",
  key: folderKey(id),
  folder: { id, parentFolderId: null, name: id },
});

const items = (entries: readonly FileMenuEntry[]): FileMenuItem[] =>
  entries.filter((entry): entry is FileMenuItem => entry.kind === "item");

const itemFor = (entries: readonly FileMenuEntry[], command: string): FileMenuItem | undefined =>
  items(entries).find((entry) => entry.command === command);

const base = {
  view: "browse" as const,
  allPinned: false,
  clipboardHolds: false,
  hasDestination: true,
  nonEmptyFolderCount: 0,
};

describe("rowMenu over one row", () => {
  const menu = rowMenu({ ...base, rows: [file("a")] });

  it("offers Open and Rename without a reason to refuse them", () => {
    expect(itemFor(menu, "open")?.disabledReason).toBeUndefined();
    expect(itemFor(menu, "rename")?.disabledReason).toBeUndefined();
  });

  it("says Download, not Download 1 File", () => {
    expect(itemFor(menu, "download")?.label).toBe("Download");
  });

  it("carries the keyboard gestures that do the same thing", () => {
    expect(itemFor(menu, "open")?.shortcut).toBe("Enter");
    expect(itemFor(menu, "rename")?.shortcut).toBe("F2");
    expect(itemFor(menu, "cut")?.shortcut).toBe("Ctrl X");
  });

  it("keeps Cut, Copy and Paste together as their own group", () => {
    const order = menu.map((entry) => (entry.kind === "item" ? entry.command : "|"));
    const cut = order.indexOf("cut");
    const copy = order.indexOf("copy");
    const paste = order.indexOf("paste");
    expect(order.slice(copy, paste + 1)).toEqual(["copy", "cut", "paste"]);
    expect(order[copy - 1]).toBe("|");
    expect(order[paste + 1]).toBe("|");
    expect(cut).toBeGreaterThan(copy);
  });
});

describe("rowMenu over many rows", () => {
  const menu = rowMenu({ ...base, rows: [file("a"), file("b"), file("c")] });

  it("counts the acts that can take many", () => {
    expect(itemFor(menu, "download")?.label).toBe("Download 3 Files");
    expect(itemFor(menu, "delete")?.label).toBe("Delete 3 Files");
    expect(itemFor(menu, "pin")?.label).toBe("Pin 3 Files to Top");
  });

  it("disables the one-item gestures rather than removing them, and says why", () => {
    const open = itemFor(menu, "open");
    const rename = itemFor(menu, "rename");
    expect(open?.disabledReason).toBeTruthy();
    expect(rename?.disabledReason).toBeTruthy();
  });

  it("omits the acts that have no meaning over many", () => {
    expect(menu.some((entry) => entry.kind === "flyout" && entry.command === "convert")).toBe(
      false,
    );
    expect(itemFor(menu, "browseInside")).toBeUndefined();
  });

  it("speaks a mixed selection as items, not as files", () => {
    const mixed = rowMenu({ ...base, rows: [file("a"), folder("d")] });
    expect(itemFor(mixed, "download")?.label).toBe("Download 2 Items");
  });

  it("refuses a bulk delete that includes a folder still holding something, and says which", () => {
    const withFolder = rowMenu({
      ...base,
      rows: [file("a"), folder("d")],
      nonEmptyFolderCount: 1,
    });
    expect(itemFor(withFolder, "delete")?.disabledReason).toContain("1 folder");
  });
});

describe("every disabled item states a reason", () => {
  it("holds across a single row, many rows, and the background menu", () => {
    const menus = [
      rowMenu({ ...base, rows: [file("a")] }),
      rowMenu({ ...base, rows: [file("a"), folder("d")], nonEmptyFolderCount: 1 }),
      backgroundMenu({ view: "browse", clipboardHolds: false, hasDestination: true }),
      backgroundMenu({ view: "results", clipboardHolds: true, hasDestination: false }),
    ];
    for (const menu of menus) {
      for (const entry of items(menu)) {
        if (entry.disabledReason !== undefined) expect(entry.disabledReason).not.toBe("");
      }
    }
  });

  it("says the clipboard is empty rather than leaving Paste silently off", () => {
    const menu = rowMenu({ ...base, rows: [file("a")] });
    expect(itemFor(menu, "paste")?.disabledReason).toContain("clipboard");
  });
});

describe("backgroundMenu", () => {
  it("offers the folder-level acts where a folder is the destination", () => {
    const menu = backgroundMenu({ view: "browse", clipboardHolds: true, hasDestination: true });
    expect(itemFor(menu, "newFolder")?.disabledReason).toBeUndefined();
    expect(itemFor(menu, "upload")?.disabledReason).toBeUndefined();
    expect(itemFor(menu, "paste")?.disabledReason).toBeUndefined();
  });

  it("turns every destination-scoped act off where the view has no current folder", () => {
    // Search Results shows rows from many folders, so "the folder you are looking at" would name a
    // folder the view never shows.
    const menu = backgroundMenu({ view: "results", clipboardHolds: true, hasDestination: false });
    for (const command of ["newFolder", "newDocument", "upload", "paste"]) {
      expect(itemFor(menu, command)?.disabledReason).toBeTruthy();
    }
    // Select All still works: it is about what is on screen, not about where to write.
    expect(itemFor(menu, "selectAll")?.disabledReason).toBeUndefined();
  });
});

describe("the Convert flyout", () => {
  const convertOf = (entries: readonly FileMenuEntry[]): FileMenuFlyout | undefined =>
    entries.find(
      (entry): entry is FileMenuFlyout => entry.kind === "flyout" && entry.command === "convert",
    );

  it("offers the formats a Word file can become, read as extensions", () => {
    const menu = rowMenu({
      ...base,
      rows: [
        file("letter", {
          name: "letter.docx",
          sniffedContentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      ],
    });
    const flyout = convertOf(menu);
    expect(flyout?.disabledReason).toBeUndefined();
    const labels = flyout?.formats?.map((format) => format.label) ?? [];
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(label).toMatch(/^To [a-z0-9]+( \(.+\))?$/);
  });

  it("is disabled with its reason when nothing converts from the file", () => {
    const menu = rowMenu({
      ...base,
      rows: [file("blob", { name: "blob.unknownthing", sniffedContentType: null })],
    });
    expect(convertOf(menu)?.disabledReason).toBe("Nothing converts from this kind of file.");
  });

  it("is disabled for a file with no committed version", () => {
    const menu = rowMenu({ ...base, rows: [file("pending", { currentVersionId: null })] });
    expect(convertOf(menu)?.disabledReason).toMatch(/no committed version/);
  });
});
