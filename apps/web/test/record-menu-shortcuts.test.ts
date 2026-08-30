import { describe, expect, it } from "vitest";
import {
  fileRecordMenu,
  folderRecordMenu,
  type FileMenuContext,
  type FileRecord,
} from "../src/lib/records/file-record-menu.ts";
import {
  isEnabled,
  menuItems,
  shortcutKeycaps,
  type RecordMenuAction,
} from "../src/lib/records/record-menu-model.ts";
import { shortcutAction, type Keystroke } from "../src/lib/records/record-menu-shortcuts.ts";

/*
 * The shortcut half.
 *
 * These tests exist because of one specific defect: a menu drew the clipboard chords down its right
 * edge while nothing listened for them, so the menu taught a gesture the product did not have. The
 * sweep at the bottom is the one that would have caught it — for EVERY row that displays a chord,
 * pressing that chord must reach that row's own action object. It is written over the menu rather
 * than over a list of keys precisely so a new row with a new chord cannot be added without wiring.
 */

const file = (over: Partial<FileRecord> = {}): FileRecord => ({
  identifier: over.name ?? "file",
  name: "Answer.pdf",
  isFolder: false,
  pinned: false,
  hasContents: false,
  isArchive: false,
  documentType: null,
  color: null,
  icon: null,
  convertTargets: [],
  ...over,
});

const context = (over: Partial<FileMenuContext> = {}): FileMenuContext => ({
  surface: "browse",
  currentFolderName: "Discovery",
  clipboard: { operation: "copy", count: 1 },
  documentTypes: [],
  folderColors: [],
  folderIcons: [],
  archiveIsDeleted: false,
  ...over,
});

const keystroke = (over: Partial<Keystroke>): Keystroke => ({
  key: "c",
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
});

const AT_REST = { inTextField: false, hasTextSelection: false };
/** A platform string, passed explicitly so these never depend on where the suite happens to run. */
const WINDOWS = "Win32";
const APPLE = "macOS";

describe("every shortcut a row displays actually fires that row", () => {
  const menu = fileRecordMenu([file()], file(), context());

  it("reaches the very action object the row renders, not a copy of it", () => {
    const copyRow = menuItems(menu).find((item) => item.identifier === "copy");
    const fired = shortcutAction(menu, keystroke({ key: "c", ctrlKey: true }), AT_REST, WINDOWS);
    expect(fired).toBe(copyRow);
  });

  it("fires cut, copy and paste from the chords they advertise", () => {
    expect(
      shortcutAction(menu, keystroke({ key: "x", ctrlKey: true }), AT_REST, WINDOWS)?.identifier,
    ).toBe("cut");
    expect(
      shortcutAction(menu, keystroke({ key: "c", ctrlKey: true }), AT_REST, WINDOWS)?.identifier,
    ).toBe("copy");
    expect(
      shortcutAction(menu, keystroke({ key: "v", ctrlKey: true }), AT_REST, WINDOWS)?.identifier,
    ).toBe("paste");
  });

  it("fires Open from Enter, the same gesture a double-click is", () => {
    expect(shortcutAction(menu, keystroke({ key: "Enter" }), AT_REST, WINDOWS)?.identifier).toBe(
      "open",
    );
  });

  it("fires Select All in the folder menu", () => {
    const folderMenu = folderRecordMenu(context());
    expect(
      shortcutAction(folderMenu, keystroke({ key: "a", ctrlKey: true }), AT_REST, WINDOWS)
        ?.identifier,
    ).toBe("selectAll");
  });

  /*
   * The sweep. Any row that grows a chord is covered the day it is written, which is the only form
   * of this check that cannot go stale.
   */
  it("leaves no displayed chord unwired, across every menu this catalogue builds", () => {
    const menus = [
      fileRecordMenu([file()], file(), context()),
      fileRecordMenu([file({ name: "a" }), file({ name: "b" })], file({ name: "a" }), context()),
      folderRecordMenu(context()),
    ];
    let checked = 0;
    for (const candidate of menus) {
      for (const item of menuItems(candidate)) {
        if (item.kind !== "action" || item.shortcut === undefined) continue;
        checked += 1;
        const action = item;
        const fired = shortcutAction(
          candidate,
          keystroke({
            key: action.shortcut?.key ?? "",
            ctrlKey: action.shortcut?.commandModifier ?? false,
          }),
          AT_REST,
          WINDOWS,
        );
        if (isEnabled(action))
          expect(fired, `${action.identifier} is displayed but dead`).toBe(action);
        else expect(fired, `${action.identifier} is refused and still fired`).toBeNull();
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("the handler knows when a key is not its business", () => {
  const menu = fileRecordMenu([file()], file(), context());

  it("leaves every key to a field that has focus", () => {
    const inField = { inTextField: true, hasTextSelection: false };
    expect(
      shortcutAction(menu, keystroke({ key: "c", ctrlKey: true }), inField, WINDOWS),
    ).toBeNull();
    expect(
      shortcutAction(menu, keystroke({ key: "v", ctrlKey: true }), inField, WINDOWS),
    ).toBeNull();
  });

  it("yields Copy to a real text selection, and keeps Cut and Paste", () => {
    const selecting = { inTextField: false, hasTextSelection: true };
    expect(
      shortcutAction(menu, keystroke({ key: "c", ctrlKey: true }), selecting, WINDOWS),
    ).toBeNull();
    expect(
      shortcutAction(menu, keystroke({ key: "x", ctrlKey: true }), selecting, WINDOWS)?.identifier,
    ).toBe("cut");
  });

  it("does not fire a refused row from its own keycaps", () => {
    const empty = fileRecordMenu([file()], file(), context({ clipboard: null }));
    expect(
      shortcutAction(empty, keystroke({ key: "v", ctrlKey: true }), AT_REST, WINDOWS),
    ).toBeNull();
  });

  it("ignores a chord carrying a modifier the row does not ask for", () => {
    expect(shortcutAction(menu, keystroke({ key: "c" }), AT_REST, WINDOWS)).toBeNull();
    expect(
      shortcutAction(menu, keystroke({ key: "c", ctrlKey: true, altKey: true }), AT_REST, WINDOWS),
    ).toBeNull();
    expect(
      shortcutAction(
        menu,
        keystroke({ key: "c", ctrlKey: true, shiftKey: true }),
        AT_REST,
        WINDOWS,
      ),
    ).toBeNull();
  });

  it("takes the command key the platform actually uses", () => {
    expect(
      shortcutAction(menu, keystroke({ key: "c", metaKey: true }), AT_REST, APPLE)?.identifier,
    ).toBe("copy");
    expect(shortcutAction(menu, keystroke({ key: "c", ctrlKey: true }), AT_REST, APPLE)).toBeNull();
  });
});

describe("the keycaps a row draws are the keys the reader has", () => {
  it("writes the modifier the way the platform writes it", () => {
    const menu = fileRecordMenu([file()], file(), context());
    const copyRow = menuItems(menu).find((item) => item.identifier === "copy") as RecordMenuAction;
    const shortcut = copyRow.shortcut;
    expect(shortcut).toBeDefined();
    if (shortcut === undefined) return;
    expect(shortcutKeycaps(shortcut, WINDOWS)).toEqual(["Ctrl", "C"]);
    expect(shortcutKeycaps(shortcut, APPLE)).toEqual(["⌘", "C"]);
  });

  it("leaves a named key spelled out rather than shouting it", () => {
    const menu = fileRecordMenu([file()], file(), context());
    const openRow = menuItems(menu).find((item) => item.identifier === "open") as RecordMenuAction;
    const shortcut = openRow.shortcut;
    expect(shortcut).toBeDefined();
    if (shortcut === undefined) return;
    expect(shortcutKeycaps(shortcut, WINDOWS)).toEqual(["Enter"]);
  });
});
