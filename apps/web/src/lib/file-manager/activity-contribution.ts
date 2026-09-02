/*
 * How a document reads on the matter's Activity section — declared by the file manager, because
 * only the file manager knows what a file is.
 */
import FileText from "@lucide/svelte/icons/file-text";
import {
  factNumber,
  factText,
  navigateInto,
  type ActivityContribution,
  type DescribedRow,
  type Fact,
} from "$lib/activity/contribution.ts";
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
