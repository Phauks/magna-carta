// @vitest-environment happy-dom
/*
 * Renaming from the details panel, as the owner reported it: "clicking the name in the right
 * sidebar to change the name does not create a rename field in that area; it instead selects the
 * file in the main area but not enough to actually change the name."
 *
 * The panel used to call back to the file LIST to open its rename field, which put the cursor on a
 * row that may be scrolled out of view or in another folder. So the test that matters is the one a
 * source scan cannot make: MOUNT the panel, press the name, and assert a field appeared in the
 * panel holding this record's name — then that Enter commits it, Escape abandons it, and a refusal
 * leaves the record's own name standing with the reason beside it.
 *
 * A folder row is the subject on purpose: it takes the same header and none of the tab machinery,
 * so what fails here can only be the rename.
 */
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FolderAggregate, FileManagerRow } from "$lib/file-manager/file-rows.ts";
import FileInspector from "$lib/file-manager/file-inspector.svelte";

const AGGREGATE: FolderAggregate = {
  fileCount: 2,
  folderCount: 0,
  totalBytes: 2048,
  latestModified: "2026-01-01T00:00:00.000Z",
  safety: "clean",
};

const FOLDER_ROW: FileManagerRow = {
  kind: "folder",
  key: "folder:folder_a",
  folder: { id: "folder_a", parentFolderId: null, name: "Discovery" },
};

let host: HTMLElement;
let mounted: Record<string, unknown> | null = null;
/** Every name the panel asked to write, in order. */
let asked: string[];
/** What the host answers with: null takes the name, a sentence refuses it. */
let refusal: string | null;

function open(row: FileManagerRow = FOLDER_ROW): void {
  mounted = mount(FileInspector, {
    target: host,
    props: {
      row,
      hideExtensions: false,
      documentTypeName: () => "",
      documentTypes: [],
      versions: null,
      versionsLoading: false,
      versionsFailure: null,
      onRetryVersions: () => {},
      integrity: null,
      integrityVersionId: null,
      integrityRunning: false,
      scans: null,
      scansLoading: false,
      scansFailure: null,
      onRetryScans: () => {},
      rescanRunning: false,
      onRescan: () => {},
      folderAggregateOf: () => AGGREGATE,
      onClose: () => {},
      onRenameCommit: (name: string) => {
        asked.push(name);
        return Promise.resolve(refusal);
      },
      onPickDocumentType: () => {},
      onAddDocumentType: () => {},
      onVerifyIntegrity: () => {},
      onOpenVersion: () => {},
      onRestoreVersion: () => {},
    },
  }) as Record<string, unknown>;
  flushSync();
}

function nameControl(): HTMLButtonElement {
  const found = host.querySelector<HTMLButtonElement>('button[title="Rename"]');
  if (found === null) throw new Error("the panel is not showing a name to press");
  return found;
}

function nameField(): HTMLInputElement | null {
  return host.querySelector<HTMLInputElement>('input[aria-label="New name"]');
}

/** The field, or a failure naming what the panel is showing instead. */
function openField(): HTMLInputElement {
  const field = nameField();
  if (field === null) throw new Error("no rename field opened in the panel");
  return field;
}

/** Let the commit's promise settle, then paint what it decided. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
}

function press(field: HTMLInputElement, key: string): void {
  field.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  flushSync();
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  asked = [];
  refusal = null;
});

afterEach(() => {
  if (mounted !== null) void unmount(mounted);
  mounted = null;
  host.remove();
});

describe("the details panel renames what it is showing, where it shows it", () => {
  it("opens the field in the panel, holding the record's own name", () => {
    open();
    expect(nameField()).toBeNull();
    nameControl().click();
    flushSync();
    const field = openField();
    expect(field.value).toBe("Discovery");
    // Nothing was asked of the host: pressing the name opens a field, it does not write.
    expect(asked).toEqual([]);
  });

  it("commits on Enter and closes back to the name", async () => {
    open();
    nameControl().click();
    flushSync();
    const field = openField();
    field.value = "Pleadings";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    press(field, "Enter");
    await settle();
    expect(asked).toEqual(["Pleadings"]);
    expect(nameField()).toBeNull();
  });

  it("abandons on Escape, writing nothing", () => {
    open();
    nameControl().click();
    flushSync();
    const field = openField();
    field.value = "Something Else";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    press(field, "Escape");
    expect(asked).toEqual([]);
    expect(nameField()).toBeNull();
    expect(nameControl().textContent?.trim()).toBe("Discovery");
  });

  it("commits when the reader clicks away, because a typed name is a name they meant", async () => {
    open();
    nameControl().click();
    flushSync();
    const field = openField();
    field.value = "Exhibits";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    field.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
    await settle();
    expect(asked).toEqual(["Exhibits"]);
  });

  it("writes nothing when the name did not change", async () => {
    open();
    nameControl().click();
    flushSync();
    press(openField(), "Enter");
    await settle();
    // The same name is not a rename, and a write that changes nothing would still audit one.
    expect(asked).toEqual([]);
  });

  it("keeps the old name and states the refusal, with the field still open to fix it", async () => {
    refusal = '"Pleadings" is already here. Choose a different name.';
    open();
    nameControl().click();
    flushSync();
    const field = openField();
    field.value = "Pleadings";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    press(field, "Enter");
    await settle();
    expect(asked).toEqual(["Pleadings"]);
    // The field stays open holding what was typed: a collision is fixed where it was written.
    const stillOpen = openField();
    expect(stillOpen.value).toBe("Pleadings");
    expect(stillOpen.getAttribute("aria-invalid")).toBe("true");
    expect(host.textContent).toContain("is already here");
  });
});
