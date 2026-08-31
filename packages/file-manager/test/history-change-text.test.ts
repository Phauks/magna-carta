import type { FolderId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  anyEntryReferencesAFolder,
  collectReferencedDocumentTypeIds,
  folderTextResolver,
  GONE_FOLDER_TEXT,
  MATTER_ROOT_TEXT,
  resolveHistoryChangeTexts,
} from "../src/history-change-text.ts";
import type { FolderNode } from "../src/queries.ts";

const parent = "folder_parent" as FolderId;
const child = "folder_child" as FolderId;
const gone = "folder_gone" as FolderId;

const folders: FolderNode[] = [
  { id: parent, parentFolderId: null, name: "Pleadings" },
  { id: child, parentFolderId: parent, name: "Drafts" },
];

const lookups = {
  folderText: folderTextResolver(folders),
  documentTypeName: (id: string) => (id === "documentType_known" ? "Affidavit" : null),
};

describe("folderTextResolver", () => {
  it("renders the current path, the root, and the gone-folder fallback", () => {
    const folderText = folderTextResolver(folders);
    expect(folderText(child)).toBe("Pleadings / Drafts");
    expect(folderText(parent)).toBe("Pleadings");
    expect(folderText(null)).toBe(MATTER_ROOT_TEXT);
    expect(folderText(gone)).toBe(GONE_FOLDER_TEXT);
  });
});

describe("resolveHistoryChangeTexts", () => {
  it("resolves a move's recorded folder ids to path text (null id = the matter root)", () => {
    const texts = resolveHistoryChangeTexts(
      {
        event: "file.moved",
        versionNumber: null,
        metadata: { fromFolderId: child, toFolderId: null },
      },
      lookups,
    );
    expect(texts).toEqual({ fromText: "Pleadings / Drafts", toText: MATTER_ROOT_TEXT });
  });

  it("resolves a delete's origin and a restore's destination, current key and legacy key alike", () => {
    expect(
      resolveHistoryChangeTexts(
        { event: "file.deleted", versionNumber: null, metadata: { fromFolderId: parent } },
        lookups,
      ),
    ).toEqual({ fromText: "Pleadings", toText: null });
    expect(
      resolveHistoryChangeTexts(
        { event: "file.restored", versionNumber: null, metadata: { toFolderId: child } },
        lookups,
      ),
    ).toEqual({ fromText: null, toText: "Pleadings / Drafts" });
    // Rows written before the key was normalized still resolve.
    expect(
      resolveHistoryChangeTexts(
        { event: "file.restored", versionNumber: null, metadata: { restoredToFolderId: parent } },
        lookups,
      ),
    ).toEqual({ fromText: null, toText: "Pleadings" });
  });

  it("resolves a document-type assignment to the type's current name, null when cleared or gone", () => {
    expect(
      resolveHistoryChangeTexts(
        {
          event: "file.document_type_assigned",
          versionNumber: null,
          metadata: { documentTypeId: "documentType_known" },
        },
        lookups,
      ),
    ).toEqual({ fromText: null, toText: "Affidavit" });
    expect(
      resolveHistoryChangeTexts(
        {
          event: "file.document_type_assigned",
          versionNumber: null,
          metadata: { documentTypeId: null },
        },
        lookups,
      ),
    ).toEqual({ fromText: null, toText: null });
  });

  it("renders a version commit's number and honest blanks for metadata that predates the facts", () => {
    expect(
      resolveHistoryChangeTexts(
        { event: "file.version_committed", versionNumber: 3, metadata: null },
        lookups,
      ),
    ).toEqual({ fromText: null, toText: "3" });
    // The pre-metadata rows: no metadata means no answer, never a guess.
    for (const event of ["file.moved", "file.deleted", "file.restored", "file.renamed"]) {
      expect(
        resolveHistoryChangeTexts({ event, versionNumber: null, metadata: null }, lookups),
      ).toEqual({ fromText: null, toText: null });
    }
  });

  it("renders a rename as blanks — names never ride audit metadata", () => {
    expect(
      resolveHistoryChangeTexts(
        { event: "file.renamed", versionNumber: null, metadata: {} },
        lookups,
      ),
    ).toEqual({ fromText: null, toText: null });
  });
});

describe("page-level lookup gathering", () => {
  it("collects the distinct referenced document-type ids and detects folder-needing entries", () => {
    const inputs = [
      { event: "file.renamed", versionNumber: null, metadata: {} },
      {
        event: "file.document_type_assigned",
        versionNumber: null,
        metadata: { documentTypeId: "documentType_known" },
      },
      {
        event: "file.document_type_assigned",
        versionNumber: null,
        metadata: { documentTypeId: "documentType_known" },
      },
      {
        event: "file.document_type_assigned",
        versionNumber: null,
        metadata: { documentTypeId: null },
      },
    ];
    expect(collectReferencedDocumentTypeIds(inputs)).toEqual(["documentType_known"]);
    expect(anyEntryReferencesAFolder(inputs)).toBe(false);
    expect(
      anyEntryReferencesAFolder([
        {
          event: "file.moved",
          versionNumber: null,
          metadata: { fromFolderId: null, toFolderId: null },
        },
      ]),
    ).toBe(true);
  });
});
