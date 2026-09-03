/*
 * How a document reads on the matter's Activity section — declared by the file manager, because
 * only the file manager knows what a file is.
 */
import FileClock from "@lucide/svelte/icons/file-clock";
import FileText from "@lucide/svelte/icons/file-text";
import {
  factNumber,
  factText,
  navigateInto,
  type ActivityContribution,
  type DescribedRow,
  type Fact,
} from "$lib/activity/contribution.ts";
import { historyActionLabel } from "./file-columns.ts";
import { fileSafetyKey, fileSafetyWord, fileSizeText, fileTypeLabel } from "./file-identity.ts";

/** The facts the file source's describe projects, read back in the file manager's own words. */
function fileFacts(row: DescribedRow) {
  const facts = row.facts;
  return {
    contentType: factText(facts, "contentType"),
    sizeBytes: factNumber(facts, "sizeBytes"),
    versionNumber: factNumber(facts, "versionNumber"),
    status: factText(facts, "status"),
    scanVerdict: factText(facts, "scanVerdict"),
    hasVersion: factNumber(facts, "hasVersion") === 1,
    documentTypeId: factText(facts, "documentTypeId"),
  };
}

export const documentActivityContribution: ActivityContribution = {
  sourceKey: "documentFiled",
  section: "Files",
  noun: "Document",
  // Never "filed": to a lawyer, filing means filing with a court, and this platform files nothing
  // with a court. The wire key stays documentFiled because it is a contract; the words are ours.
  happened: "A document was added to the matter",
  icon: FileText,
  labelMeaning: "Document type",
  // The firm's document types and the identification's labels are open vocabularies, so the Type
  // filter learns them from the rows rather than from a list here that would fall behind.
  types: [],
  typeOf: (row) =>
    fileTypeLabel({
      fileName: row.title,
      contentType: fileFacts(row).contentType,
      documentTypeName: row.typeText,
    }),
  // The file manager's own glyph, over the same inputs the Files section draws it from.
  glyphOf: (row) => ({
    kind: "file",
    fileName: row.title,
    contentType: fileFacts(row).contentType,
  }),
  factsOf: (row) => {
    const facts = fileFacts(row);
    const safety = fileSafetyKey(facts);
    const safetyWord = fileSafetyWord(safety);
    const result: Fact[] = [];
    const size = fileSizeText(facts.sizeBytes);
    if (size !== undefined) result.push({ value: size });
    if (facts.versionNumber !== null && facts.versionNumber > 1) {
      result.push({ label: "Version", value: String(facts.versionNumber) });
    }
    if (safetyWord !== undefined) {
      result.push({
        value: safetyWord,
        tone: safety === "error" || safety === "warning" ? "danger" : "info",
      });
    }
    return result;
  },
  open: navigateInto,
};

/*
 * What happened to a document after it arrived — the File History view's own events, on the
 * chronology, in the File History view's own words. The Type word IS the action (Renamed, Moved,
 * Deleted, Restored, New Version, Version Restored, Document Type Set, Flagged), read through the
 * same `historyActionLabel` the History view's Action column reads, so the two cannot disagree.
 */
const HISTORY_HAPPENED: Readonly<Record<string, string>> = {
  "file.renamed": "A document was renamed",
  "file.moved": "A document was moved to another folder",
  "file.deleted": "A document was deleted",
  "file.restored": "A deleted document was restored",
  "file.version_committed": "A new version of a document was added",
  "file.version_restored": "An earlier version of a document was restored",
  "file.document_type_assigned": "A document's type was set",
  "file.quarantined": "A document was held by the safety check",
};

export const FILE_HISTORY_TYPES: readonly string[] =
  Object.keys(HISTORY_HAPPENED).map(historyActionLabel);

export const fileHistoryActivityContribution: ActivityContribution = {
  sourceKey: "fileHistory",
  section: "Files",
  noun: "File change",
  happened: (kind) => HISTORY_HAPPENED[kind] ?? "Something was done to a document",
  icon: FileClock,
  labelMeaning: "Action",
  types: FILE_HISTORY_TYPES,
  typeOf: (row) => {
    const event = factText(row.facts, "event");
    return event === null ? "File change" : historyActionLabel(event);
  },
  // The file's own glyph, from its current name: the version this act concerned may carry a
  // different content type, and the name is what the reader recognises.
  glyphOf: (row) => ({ kind: "file", fileName: row.title, contentType: null }),
  factsOf: (row) => {
    const result: Fact[] = [];
    const versionNumber = factNumber(row.facts, "versionNumber");
    if (versionNumber !== null) result.push({ label: "Version", value: String(versionNumber) });
    if (factText(row.facts, "event") === "file.quarantined") {
      result.push({ value: "Held", tone: "danger" });
    }
    return result;
  },
  open: navigateInto,
};
