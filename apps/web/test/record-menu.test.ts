import { describe, expect, it } from "vitest";
import {
  fileRecordMenu,
  folderRecordMenu,
  menuTargets,
  pasteDestination,
  recordNoun,
  type FileMenuContext,
  type FileRecord,
  type FileSurface,
} from "../src/lib/records/file-record-menu.ts";
import { ledgerRecordMenu, type LedgerRecord } from "../src/lib/records/ledger-record-menu.ts";
import {
  countedLabel,
  isEnabled,
  menuItem,
  menuItems,
  sharedMark,
  type RecordMenuAction,
  type RecordMenuFlyout,
  type RecordMenuModel,
} from "../src/lib/records/record-menu-model.ts";

/*
 * The menu's decisions, asserted as the pure functions they are.
 *
 * What is worth testing here is not that a menu renders — it is every judgment the menu makes about
 * a selection: which verbs it offers, what each one is called and counted at, which are refused and
 * in what words, and which are not there at all. Those are the answers a reader is promised, and
 * they are the answers that quietly drift when one surface is corrected and another is not.
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

const folder = (over: Partial<FileRecord> = {}): FileRecord =>
  file({ isFolder: true, name: "Discovery", identifier: "discovery", ...over });

const context = (over: Partial<FileMenuContext> = {}): FileMenuContext => ({
  surface: "browse",
  currentFolderName: "Discovery",
  clipboard: null,
  documentTypes: [
    { identifier: "pleading", label: "Pleading" },
    { identifier: "correspondence", label: "Correspondence" },
  ],
  folderColors: [
    { identifier: "red", label: "Red" },
    { identifier: "blue", label: "Blue" },
  ],
  folderIcons: [{ identifier: "briefcase", label: "Briefcase" }],
  archiveIsDeleted: false,
  ...over,
});

/** One row of the menu, by identifier, failing loudly rather than returning undefined. */
function row(menu: RecordMenuModel, identifier: string): RecordMenuAction {
  const item = menuItem(menu, identifier);
  expect(item, `no row named ${identifier}`).not.toBeNull();
  expect(item?.kind).toBe("action");
  return item as RecordMenuAction;
}

function flyout(menu: RecordMenuModel, identifier: string): RecordMenuFlyout {
  const item = menuItem(menu, identifier);
  expect(item, `no flyout named ${identifier}`).not.toBeNull();
  expect(item?.kind).toBe("flyout");
  return item as RecordMenuFlyout;
}

const labels = (menu: RecordMenuModel): string[] => menuItems(menu).map((item) => item.label);

// --- the grammar ------------------------------------------------------------------------------

describe("countedLabel", () => {
  it("drops the object at one and states it over many", () => {
    const noun = { singular: "File", plural: "Files" };
    expect(countedLabel({ verb: "Download", count: 1, noun })).toBe("Download");
    expect(countedLabel({ verb: "Download", count: 3, noun })).toBe("Download 3 Files");
  });

  it("drops the preposition with the object, so no verb dangles an 'on'", () => {
    const noun = { singular: "File", plural: "Files" };
    expect(countedLabel({ verb: "Re-run", count: 1, noun, preposition: "on" })).toBe("Re-run");
    expect(countedLabel({ verb: "Re-run", count: 4, noun, preposition: "on" })).toBe(
      "Re-run on 4 Files",
    );
  });

  it("keeps the object at one where the sentence would lose its subject without it", () => {
    const noun = { singular: "File", plural: "Files" };
    expect(
      countedLabel({
        verb: "Extract",
        count: 1,
        noun,
        style: "demonstrative",
        suffix: "Into the Matter…",
      }),
    ).toBe("Extract This File Into the Matter…");
    expect(
      countedLabel({
        verb: "Extract",
        count: 2,
        noun,
        style: "demonstrative",
        suffix: "Into the Matter…",
      }),
    ).toBe("Extract 2 Files Into the Matter…");
  });
});

describe("sharedMark", () => {
  it("reports the value only where the whole scope agrees", () => {
    expect(sharedMark(["red", "red"])).toBe("red");
    expect(sharedMark(["red", "blue"])).toBeNull();
    expect(sharedMark([])).toBeNull();
  });
});

describe("recordNoun", () => {
  it("calls a mixed selection Items, because it is neither files nor folders", () => {
    expect(recordNoun([file(), file({ name: "b" })]).plural).toBe("Files");
    expect(recordNoun([folder(), folder({ name: "b" })]).plural).toBe("Folders");
    expect(recordNoun([file(), folder()]).plural).toBe("Items");
  });
});

describe("menuTargets", () => {
  const one = file({ name: "one" });
  const two = file({ name: "two" });
  const three = file({ name: "three" });

  it("speaks for the whole selection when the click landed inside it", () => {
    expect(menuTargets([one, two], two)).toEqual([one, two]);
  });

  it("re-aims at the row when the click landed outside the selection", () => {
    expect(menuTargets([one, two], three)).toEqual([three]);
  });
});

// --- counted verbs ----------------------------------------------------------------------------

describe("a verb that acts on many says how many", () => {
  const many = [file({ name: "a" }), file({ name: "b" }), file({ name: "c" })];

  it("counts download, cut, copy, pin, share and delete", () => {
    const menu = fileRecordMenu(many, many[0] as FileRecord, context());
    expect(row(menu, "download").label).toBe("Download 3 Files");
    expect(row(menu, "cut").label).toBe("Cut 3 Files");
    expect(row(menu, "copy").label).toBe("Copy 3 Files");
    expect(row(menu, "pin").label).toBe("Pin 3 Files");
    expect(row(menu, "share").label).toBe("Share 3 Files");
    expect(row(menu, "delete").label).toBe("Delete 3 Files");
  });

  it("counts nothing at one", () => {
    const one = [file()];
    const menu = fileRecordMenu(one, one[0] as FileRecord, context());
    expect(row(menu, "download").label).toBe("Download");
    expect(row(menu, "delete").label).toBe("Delete");
  });

  it("calls a mixed selection Items rather than picking a side", () => {
    const mixed = [file({ name: "a" }), folder({ name: "b", identifier: "b" })];
    const menu = fileRecordMenu(mixed, mixed[0] as FileRecord, context());
    expect(row(menu, "download").label).toBe("Download 2 Items");
  });

  it("says what pinning will do, and keeps the menu open so several rows can be pinned", () => {
    const pinned = [file({ name: "a", pinned: true }), file({ name: "b", pinned: true })];
    const menu = fileRecordMenu(pinned, pinned[0] as FileRecord, context());
    expect(row(menu, "pin").label).toBe("Unpin 2 Files");
    expect(row(menu, "pin").marked).toBe(true);
    expect(row(menu, "pin").staysOpen).toBe(true);

    const mixed = [file({ name: "a", pinned: true }), file({ name: "b" })];
    expect(row(fileRecordMenu(mixed, mixed[0] as FileRecord, context()), "pin").label).toBe(
      "Pin 2 Files",
    );
  });
});

// --- scoped verbs -----------------------------------------------------------------------------

describe("a verb counts what it will touch, not the selection", () => {
  const mixed = [
    file({ name: "a" }),
    file({ name: "b" }),
    file({ name: "c" }),
    folder({ name: "Discovery", identifier: "d1" }),
    folder({ name: "Pleadings", identifier: "d2" }),
  ];

  it("scopes Set Document Type to the files", () => {
    const menu = fileRecordMenu(mixed, mixed[0] as FileRecord, context());
    expect(flyout(menu, "setDocumentType").label).toBe("Set Document Type for 3 Files");
  });

  it("scopes Color and Icon to the folders", () => {
    const menu = fileRecordMenu(mixed, mixed[0] as FileRecord, context());
    expect(flyout(menu, "setColor").label).toBe("Color for 2 Folders");
    expect(flyout(menu, "setIcon").label).toBe("Icon for 2 Folders");
  });

  it("scopes the safety re-run to the files, and does not offer one for folders alone", () => {
    const menu = fileRecordMenu(mixed, mixed[0] as FileRecord, context());
    expect(row(menu, "rerunSafetyCheck").label).toBe("Re-run Safety Check on 3 Files");

    const foldersOnly = [folder({ name: "a", identifier: "a" })];
    expect(
      menuItem(
        fileRecordMenu(foldersOnly, foldersOnly[0] as FileRecord, context()),
        "rerunSafetyCheck",
      ),
    ).toBeNull();
  });

  it("offers Color only where a folder is in the selection", () => {
    const files = [file()];
    expect(
      menuItem(fileRecordMenu(files, files[0] as FileRecord, context()), "setColor"),
    ).toBeNull();
  });

  it("marks a shared value only where the whole scope agrees", () => {
    const agreeing = [
      folder({ name: "a", identifier: "a", color: "red" }),
      folder({ name: "b", identifier: "b", color: "red" }),
    ];
    const marked = flyout(
      fileRecordMenu(agreeing, agreeing[0] as FileRecord, context()),
      "setColor",
    ).choices;
    expect(marked.find((choice) => choice.identifier === "red")?.selected).toBe(true);

    const disagreeing = [
      folder({ name: "a", identifier: "a", color: "red" }),
      folder({ name: "b", identifier: "b", color: "blue" }),
    ];
    const unmarked = flyout(
      fileRecordMenu(disagreeing, disagreeing[0] as FileRecord, context()),
      "setColor",
    ).choices;
    expect(unmarked.every((choice) => choice.selected === false)).toBe(true);
  });
});

// --- refusals ---------------------------------------------------------------------------------

describe("a verb that cannot run says why, and stays on screen", () => {
  const many = [file({ name: "a" }), file({ name: "b" })];

  it("refuses Open and Rename over a selection rather than dropping them", () => {
    const menu = fileRecordMenu(many, many[0] as FileRecord, context());
    expect(row(menu, "open").label).toBe("Open");
    expect(row(menu, "open").disabledReason).toBe("Open works on one item at a time.");
    expect(row(menu, "rename").disabledReason).toBe("Rename works on one item at a time.");
  });

  it("refuses Paste with an empty clipboard, in the clipboard's own words", () => {
    const menu = fileRecordMenu([file()], file(), context());
    expect(row(menu, "paste").disabledReason).toBe("Nothing is on the clipboard yet.");
  });

  it("refuses to delete a selection carrying a folder that has contents, naming it", () => {
    const withFullFolder = [file({ name: "a" }), folder({ name: "Discovery", hasContents: true })];
    const menu = fileRecordMenu(withFullFolder, withFullFolder[0] as FileRecord, context());
    const reason = row(menu, "delete").disabledReason ?? "";
    expect(reason).toContain("Folders with contents are deleted one at a time");
    expect(reason).toContain("Discovery");
  });

  it("lets a lone folder with contents be deleted, because its question can be asked", () => {
    const one = [folder({ hasContents: true })];
    const menu = fileRecordMenu(one, one[0] as FileRecord, context());
    expect(row(menu, "delete").disabledReason).toBeUndefined();
  });

  it("never says an acknowledgement is needed in a label", () => {
    const menu = fileRecordMenu([file()], file(), context());
    for (const label of labels(menu)) {
      expect(label.toLowerCase()).not.toContain("acknowledge");
    }
  });

  it("keeps every disabled verb explained — a refusal with no reason is the defect", () => {
    const surfaces: FileSurface[] = [
      "browse",
      "deletedFiles",
      "searchResults",
      "history",
      "fileAnalysis",
      "archive",
    ];
    for (const surface of surfaces) {
      const menu = fileRecordMenu(many, many[0] as FileRecord, context({ surface }));
      for (const item of menuItems(menu)) {
        if (isEnabled(item)) continue;
        const explained =
          item.disabledReason !== undefined ||
          (item.kind === "action" && item.soonDependency !== undefined);
        expect(explained, `${surface}: ${item.identifier} is disabled with nothing said`).toBe(
          true,
        );
      }
    }
  });
});

// --- omissions --------------------------------------------------------------------------------

describe("a verb with no meaning over many is absent, not greyed", () => {
  it("drops Browse Inside and Convert over a selection", () => {
    const archive = file({ name: "Photos.zip", isArchive: true, convertTargets: ["pdf"] });
    const alone = fileRecordMenu([archive], archive, context());
    expect(menuItem(alone, "browseInside")).not.toBeNull();
    expect(menuItem(alone, "convert")).not.toBeNull();

    const withCompany = [archive, file({ name: "b" })];
    const many = fileRecordMenu(withCompany, archive, context());
    expect(menuItem(many, "browseInside")).toBeNull();
    expect(menuItem(many, "convert")).toBeNull();
  });

  it("offers no Convert at all for a kind with nothing honest to convert to", () => {
    const plain = file({ convertTargets: [] });
    expect(menuItem(fileRecordMenu([plain], plain, context()), "convert")).toBeNull();
  });

  it("offers Browse Inside only on an archive", () => {
    const plain = file();
    expect(menuItem(fileRecordMenu([plain], plain, context()), "browseInside")).toBeNull();
  });
});

// --- destination scoping ----------------------------------------------------------------------

describe("a verb that writes into the current folder exists only where one does", () => {
  it("finds no destination in the views that are not folders", () => {
    const notFolders: FileSurface[] = ["searchResults", "history", "fileAnalysis", "archive"];
    for (const surface of notFolders) {
      expect(pasteDestination([file()], context({ surface }))).toBeNull();
    }
  });

  it("treats a folder row as its own destination, in any view", () => {
    const target = folder();
    expect(pasteDestination([target], context({ surface: "searchResults" }))).toBe("Discovery");
  });

  it("refuses Paste on a file row outside browse, saying there is nowhere to paste", () => {
    const menu = fileRecordMenu([file()], file(), context({ surface: "searchResults" }));
    expect(row(menu, "paste").disabledReason).toContain("This view is not a folder");
  });

  it("lets a folder row take a paste even outside browse", () => {
    const target = folder();
    const menu = fileRecordMenu([target], target, {
      ...context({ surface: "searchResults" }),
      clipboard: { operation: "copy", count: 2 },
    });
    expect(row(menu, "paste").disabledReason).toBeUndefined();
  });

  it("refuses every creating verb in the folder menu where there is no current folder", () => {
    const menu = folderRecordMenu(context({ surface: "fileAnalysis", currentFolderName: null }));
    for (const identifier of ["newFolder", "newDocument", "upload", "paste"]) {
      expect(row(menu, identifier).disabledReason, identifier).toContain(
        "This view is not a folder",
      );
    }
    // Selecting what is on screen is not a write, so it is never gated on a destination.
    expect(row(menu, "selectAll").disabledReason).toBeUndefined();
  });
});

// --- the clipboard group ----------------------------------------------------------------------

describe("cut, copy and paste are their own group", () => {
  it("puts the three together, alone, between the menu's rules", () => {
    const menu = fileRecordMenu([file()], file(), context());
    const group = menu.find((candidate) => candidate.identifier === "clipboard");
    expect(group?.items.map((item) => item.identifier)).toEqual(["cut", "copy", "paste"]);
  });

  it("draws no group with nothing in it, so no rule bounds emptiness", () => {
    const menu = fileRecordMenu([file()], file(), context());
    for (const group of menu) expect(group.items.length).toBeGreaterThan(0);
  });
});

// --- the not-yet-built verbs --------------------------------------------------------------------

describe("a designed but unserved verb renders, marked, with its dependency", () => {
  it("offers Share, waiting on the portal, and composes over a selection", () => {
    const many = [file({ name: "a" }), file({ name: "b" }), file({ name: "c" })];
    const menu = fileRecordMenu(many, many[0] as FileRecord, context());
    expect(row(menu, "share").label).toBe("Share 3 Files");
    expect(row(menu, "share").soonDependency).toBe("client-portal document sharing");
    expect(isEnabled(row(menu, "share"))).toBe(false);
  });

  it("names the conversion engine on every convert target, and on the options row", () => {
    const convertible = file({ convertTargets: ["txt", "docx"] });
    const choices = flyout(
      fileRecordMenu([convertible], convertible, context()),
      "convert",
    ).choices;
    expect(choices.map((choice) => choice.label)).toEqual([
      "To txt",
      "To docx",
      "Convert With Options",
    ]);
    expect(choices.every((choice) => choice.soonDependency === "the conversion engine")).toBe(true);
  });

  it("calls taking a member out of a live archive an extraction and out of a deleted one a restore", () => {
    const member = file({ name: "photo.jpg" });
    const live = fileRecordMenu([member], member, context({ surface: "archive" }));
    expect(row(live, "extractIntoMatter").label).toBe("Extract This File Into the Matter…");

    const deleted = fileRecordMenu(
      [member],
      member,
      context({ surface: "archive", archiveIsDeleted: true }),
    );
    expect(row(deleted, "extractIntoMatter").label).toBe("Restore This File Into the Matter…");
    expect(row(deleted, "extractIntoMatter").soonDependency).toBe("the archive-extraction engine");
  });
});

// --- per-view verbs ----------------------------------------------------------------------------

describe("a view gets the verbs its rows can answer", () => {
  it("gives the deleted view Restore, and refuses Details over many", () => {
    const many = [file({ name: "a" }), file({ name: "b" })];
    const menu = fileRecordMenu(many, many[0] as FileRecord, context({ surface: "deletedFiles" }));
    expect(row(menu, "restore").label).toBe("Restore 2 Files");
    expect(row(menu, "details").disabledReason).toBe("Details describes one file at a time.");
    expect(menuItem(menu, "delete")).toBeNull();
  });

  it("narrows to one document only where a view holds many rows about one", () => {
    const one = [file()];
    expect(
      row(
        fileRecordMenu(one, one[0] as FileRecord, context({ surface: "history" })),
        "filterToDocument",
      ).label,
    ).toBe("Filter to This Document");
    expect(
      row(
        fileRecordMenu(one, one[0] as FileRecord, context({ surface: "searchResults" })),
        "filterToDocument",
      ).label,
    ).toBe("Filter to This File");
    for (const surface of ["browse", "deletedFiles", "fileAnalysis"] as FileSurface[]) {
      expect(
        menuItem(
          fileRecordMenu(one, one[0] as FileRecord, context({ surface })),
          "filterToDocument",
        ),
        surface,
      ).toBeNull();
    }
  });

  it("takes the reader to the document where the row is an event or a finding", () => {
    const one = [file()];
    for (const surface of ["history", "fileAnalysis"] as FileSurface[]) {
      const menu = fileRecordMenu(one, one[0] as FileRecord, context({ surface }));
      expect(menuItem(menu, "reveal"), surface).not.toBeNull();
      expect(menuItem(menu, "open"), surface).toBeNull();
    }
  });
});

// --- the ledger surfaces ------------------------------------------------------------------------

const entry = (over: Partial<LedgerRecord> = {}): LedgerRecord => ({
  identifier: "entry",
  status: "draft",
  entryNumber: "TE-0042",
  description: "Drafted the motion",
  amount: "$420.00",
  ...over,
});

const timeContext = (reviewGateEnabled = false) => ({
  recordNoun: { singular: "Time Entry", plural: "Time Entries" },
  reviewGateEnabled,
});

describe("the ledger menu separates duplicating from copying", () => {
  it("offers Duplicate as a verb and Copy as a flyout of values", () => {
    const one = entry();
    const menu = ledgerRecordMenu([one], one, timeContext());
    expect(row(menu, "duplicate").label).toBe("Duplicate");
    const values = flyout(menu, "copyValue");
    expect(values.label).toBe("Copy");
    expect(values.choices.map((choice) => choice.identifier)).toEqual([
      "entryNumber",
      "description",
      "amount",
    ]);
  });

  it("does not offer to copy a number the record has not been given", () => {
    const unnumbered = entry({ entryNumber: null });
    const values = flyout(ledgerRecordMenu([unnumbered], unnumbered, timeContext()), "copyValue");
    expect(values.choices.map((choice) => choice.identifier)).toEqual(["description", "amount"]);
  });

  it("counts duplicating and refuses copying a value over a selection", () => {
    const many = [entry({ identifier: "a" }), entry({ identifier: "b" })];
    const menu = ledgerRecordMenu(many, many[0] as LedgerRecord, timeContext());
    expect(row(menu, "duplicate").label).toBe("Duplicate 2 Time Entries");
    expect(flyout(menu, "copyValue").disabledReason).toBe(
      "Copying a value works on one record at a time.",
    );
  });
});

describe("the approval chain is absent until the firm turns review on", () => {
  const drafts = [entry({ identifier: "a" }), entry({ identifier: "b" })];

  it("says nothing about submitting or approving while the gate is off", () => {
    const menu = ledgerRecordMenu(drafts, drafts[0] as LedgerRecord, timeContext(false));
    expect(menuItem(menu, "submit")).toBeNull();
    expect(menuItem(menu, "approve")).toBeNull();
    expect(menuItem(menu, "kickBack")).toBeNull();
  });

  it("counts each chain verb over the records it can actually move", () => {
    const mixed = [
      entry({ identifier: "a", status: "draft" }),
      entry({ identifier: "b", status: "draft" }),
      entry({ identifier: "c", status: "submitted" }),
    ];
    const menu = ledgerRecordMenu(mixed, mixed[0] as LedgerRecord, timeContext(true));
    expect(row(menu, "submit").label).toBe("Submit 2 Drafts");
    expect(row(menu, "approve").label).toBe("Approve");
    expect(menuItem(menu, "kickBack")).not.toBeNull();
  });

  it("leaves out a chain verb with nothing to move, rather than greying it", () => {
    const menu = ledgerRecordMenu(drafts, drafts[0] as LedgerRecord, timeContext(true));
    expect(menuItem(menu, "submit")).not.toBeNull();
    expect(menuItem(menu, "approve")).toBeNull();
  });

  it("takes the chain's words from the product's one status vocabulary", () => {
    const menu = ledgerRecordMenu(drafts, drafts[0] as LedgerRecord, timeContext(true));
    // "Draft" is the register's own label for the status the chip on the row shows.
    expect(row(menu, "submit").label).toContain("Drafts");
  });
});

describe("withdrawing is done one record at a time", () => {
  it("refuses to void a selection, and says so", () => {
    const many = [entry({ identifier: "a" }), entry({ identifier: "b" })];
    const menu = ledgerRecordMenu(many, many[0] as LedgerRecord, timeContext());
    expect(row(menu, "void").disabledReason).toBe("Withdrawing is done one record at a time.");
  });

  it("refuses to void what is already withdrawn, in the register's own word", () => {
    const withdrawn = entry({ status: "void" });
    const menu = ledgerRecordMenu([withdrawn], withdrawn, timeContext());
    expect(row(menu, "void").disabledReason).toBe("Already void.");
  });
});
