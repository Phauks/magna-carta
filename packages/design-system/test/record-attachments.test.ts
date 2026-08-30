import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  attachableDocumentCount,
  attachableDocumentKeywords,
  unattachedDocumentFolders,
} from "../src/lib/components/record-attachments/attachable-documents.ts";
import {
  ATTACHMENTS_TAB_KEY,
  openingTabForAttachments,
} from "../src/lib/components/record-attachments/attachments-tab.ts";
import type {
  AttachableDocumentFolder,
  RecordAttachment,
} from "../src/lib/components/record-attachments/types.ts";

/*
 * RecordAttachments' package-local contract.
 *
 * What is rendered belongs to the stories, which run in a real browser with axe. What is asserted
 * here is the part a rendered tab cannot show: the rules that decide what the picker is allowed to
 * offer and which tab a record opens on, both of which are pure and both of which are settled
 * behaviour rather than presentation. The cascade is pinned for the same reason it is pinned for the
 * window this tab sits in — the recipe overrides the surfaces it dresses at equal specificity, so it
 * only works while it is imported after them, and that is silent when wrong.
 */

const PACKAGE_ROOT = join(import.meta.dirname, "..");

const attachment = (identifier: string, documentIdentifier: string): RecordAttachment => ({
  identifier,
  documentIdentifier,
  name: `${documentIdentifier}.pdf`,
});

const FOLDERS: readonly AttachableDocumentFolder[] = [
  {
    identifier: "folder-pleadings",
    name: "Pleadings",
    documents: [
      { identifier: "document-complaint", name: "Complaint.pdf" },
      { identifier: "document-answer", name: "Answer.pdf" },
    ],
  },
  {
    identifier: "folder-correspondence",
    name: "Correspondence",
    documents: [{ identifier: "document-demand", name: "Demand letter.pdf" }],
  },
];

describe("what the picker may offer", () => {
  it("offers every document while the record carries none of them", () => {
    expect(unattachedDocumentFolders(FOLDERS, [])).toEqual(FOLDERS);
  });

  it("leaves out a document this record already carries", () => {
    const offered = unattachedDocumentFolders(FOLDERS, [
      attachment("association-1", "document-answer"),
    ]);
    expect(offered.flatMap((folder) => folder.documents.map((entry) => entry.identifier))).toEqual([
      "document-complaint",
      "document-demand",
    ]);
  });

  it("drops a folder whose documents are all attached, rather than showing an empty heading", () => {
    const offered = unattachedDocumentFolders(FOLDERS, [
      attachment("association-1", "document-demand"),
    ]);
    expect(offered.map((folder) => folder.identifier)).toEqual(["folder-pleadings"]);
  });

  it("matches on the document's identity, never its name", () => {
    // Two documents in one matter can share a name, and an attachment names the one it points at.
    const sameNameElsewhere: readonly AttachableDocumentFolder[] = [
      {
        identifier: "folder-drafts",
        name: "Drafts",
        documents: [{ identifier: "document-answer-draft", name: "Answer.pdf" }],
      },
    ];
    const offered = unattachedDocumentFolders(sameNameElsewhere, [
      { identifier: "association-1", documentIdentifier: "document-answer", name: "Answer.pdf" },
    ]);
    expect(offered).toEqual(sameNameElsewhere);
  });

  it("leaves folder and document order exactly as the caller gave it", () => {
    const offered = unattachedDocumentFolders(FOLDERS, []);
    expect(offered.map((folder) => folder.name)).toEqual(["Pleadings", "Correspondence"]);
    expect(offered[0]?.documents.map((entry) => entry.name)).toEqual([
      "Complaint.pdf",
      "Answer.pdf",
    ]);
  });

  it("does not mutate the folders it was handed", () => {
    const before = structuredClone(FOLDERS);
    unattachedDocumentFolders(FOLDERS, [attachment("association-1", "document-complaint")]);
    expect(FOLDERS).toEqual(before);
  });

  it("counts what is left across every folder, so nothing-left can be told from no-match", () => {
    expect(attachableDocumentCount(FOLDERS)).toBe(3);
    expect(
      attachableDocumentCount(
        unattachedDocumentFolders(FOLDERS, [
          attachment("association-1", "document-complaint"),
          attachment("association-2", "document-answer"),
          attachment("association-3", "document-demand"),
        ]),
      ),
    ).toBe(0);
  });

  it("searches a document by its own name and by where it is filed", () => {
    const folder = FOLDERS[0]!;
    expect(attachableDocumentKeywords(folder.documents[0]!, folder)).toEqual([
      "Complaint.pdf",
      "Pleadings",
    ]);
  });
});

describe("which tab a record with files opens on", () => {
  it("opens on the attachments tab when the record carries something", () => {
    expect(openingTabForAttachments(1)).toBe(ATTACHMENTS_TAB_KEY);
  });

  it("leaves the choice alone when the record carries nothing", () => {
    expect(openingTabForAttachments(0)).toBeUndefined();
  });

  it("honours the tab a caller would rather open on when there is nothing attached", () => {
    expect(openingTabForAttachments(0, "history")).toBe("history");
  });

  it("still opens on the files when the caller named another tab and there are files", () => {
    // What is waiting beats what is usual: the reason the record opens here is that a file is on it.
    expect(openingTabForAttachments(2, "history")).toBe(ATTACHMENTS_TAB_KEY);
  });
});

describe("the recipe's place in the cascade", () => {
  const componentsCss = readFileSync(join(PACKAGE_ROOT, "src/lib/styles/components.css"), "utf8");
  const positionOf = (recipe: string): number => componentsCss.indexOf(`/${recipe}/`);

  it("is imported at all, or the tab ships wearing no recipe of its own", () => {
    expect(positionOf("record-attachments")).toBeGreaterThan(-1);
  });

  it("follows the surfaces it dresses", () => {
    for (const earlier of ["popover", "command", "alert-dialog", "record-window"]) {
      expect(positionOf("record-attachments")).toBeGreaterThan(positionOf(earlier));
    }
  });
});

describe("the tab's public surface", () => {
  const source = readFileSync(
    join(PACKAGE_ROOT, "src/lib/components/record-attachments/record-attachments.svelte"),
    "utf8",
  );

  it("declares every prop a record kind hands it", () => {
    for (const property of [
      "attachments",
      "canEdit",
      "attachDisabledReason",
      "documentSource",
      "documentSourceDisabledReason",
      "onAttachExisting",
      "onAttachUpload",
      "onDetach",
      "onOpen",
      "preview",
    ]) {
      expect(source).toContain(property);
    }
  });

  it("names the act Detach and never Delete or Remove, anywhere a reader can see it", () => {
    // Detaching ends an association; the document survives it. Copy that suggested otherwise would
    // stop people using the control, which is the expensive failure here.
    expect(source).toContain("Detach");
    for (const wrongWord of [">Delete<", ">Remove<", "Delete file", "Remove file"]) {
      expect(source).not.toContain(wrongWord);
    }
  });

  it("says where the document will still be, in the confirmation itself", () => {
    expect(source).toContain("stays in this");
  });

  it("offers the matter's own documents before the upload", () => {
    expect(source.indexOf("From the Matter…")).toBeGreaterThan(-1);
    expect(source.indexOf("From the Matter…")).toBeLessThan(source.indexOf('prompt="Upload…"'));
  });
});
