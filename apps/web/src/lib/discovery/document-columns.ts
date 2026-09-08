/*
 * What a review document looks like in the corpus listing.
 *
 * THE SOURCE NAME ANCHORS THE ROW. It is what the document was called where it came from, and it is
 * how a reviewer recognises it, quotes it in correspondence, and finds it again in the firm's own
 * file record. A document that arrived with no name renders as saying so, never as blank.
 *
 * READ-OR-NOT-READ IS A COLUMN AND NOT A HEALTH INDICATOR. Every document ends in exactly one of two
 * terminal states and there is no third; a document that could not be read stays in the corpus, is
 * countable, and appears on the exception report. It is not an error and must not be coloured like
 * one — the warning tone says "this needs a decision", which is exactly what it needs.
 *
 * SEARCHABILITY IS ITS OWN COLUMN, SEPARATE FROM PROCESSING, because they are different stages run
 * by different engines. With no search engine deployed every read document sits at "not searchable
 * yet", which is the platform's work outstanding rather than anything wrong with the document — and
 * it never reaches a report a court sees. Folding the two into one column would say otherwise.
 *
 * THE DATE IS THE DOCUMENT'S OWN, AND MANY DOCUMENTS HAVE NONE. A scan with no metadata, a file
 * whose only date is the day it was copied — undated is normal in a received production, so those
 * rows sort last rather than being hidden, and the cell says the date is unknown rather than
 * printing the day the row was made.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import type { ReviewDocument } from "./discovery-api.ts";
import { processingStateEntry, indexStateEntry } from "./discovery-vocabulary.ts";

/** Custodian and load names by identifier, joined here — never a read per row. */
export interface DocumentVocabulary {
  readonly custodianNames: ReadonlyMap<string, string>;
  readonly loadNames: ReadonlyMap<string, string>;
}

export const EMPTY_DOCUMENT_VOCABULARY: DocumentVocabulary = {
  custodianNames: new Map(),
  loadNames: new Map(),
};

/** What a cell reads for a handle nothing in hand names. Never the identifier itself. */
export const NOT_NAMED_HERE = "Not named here";

/** What the date cell reads for a document nothing dated. Not a blank, which reads as a gap. */
export const NO_KNOWN_DATE = "No date";

export function reviewDocumentColumns(
  vocabulary: DocumentVocabulary,
): GridColumn<ReviewDocument>[] {
  return [
    {
      id: "sourceName",
      label: "Document",
      anchored: true,
      value: (document) => document.sourceName ?? "",
      text: (document) => document.sourceName ?? "Unnamed",
    },
    {
      id: "custodian",
      label: "Custodian of Record",
      filter: "set",
      value: (document) =>
        vocabulary.custodianNames.get(document.recordCustodianId) ?? NOT_NAMED_HERE,
    },
    {
      id: "processingState",
      label: "Read",
      filter: "set",
      // The word, not the enum: a person narrows on "Not read", never on `excepted`.
      value: (document) => processingStateEntry(document.processingState).label,
    },
    {
      id: "indexState",
      label: "Searchable",
      filter: "set",
      value: (document) => indexStateEntry(document.indexState).label,
    },
    {
      id: "sortDate",
      label: "Date",
      type: "date",
      value: (document) => document.sortDate,
      text: (document) =>
        document.sortDate === null
          ? NO_KNOWN_DATE
          : new Date(document.sortDate).toLocaleDateString(),
    },
    {
      id: "load",
      label: "Load",
      filter: "set",
      hidden: true,
      value: (document) => vocabulary.loadNames.get(document.discoveryLoadId) ?? NOT_NAMED_HERE,
    },
    {
      id: "pageCount",
      label: "Pages",
      type: "number",
      hidden: true,
      value: (document) => document.pageCount,
    },
    {
      id: "format",
      label: "Format",
      filter: "set",
      hidden: true,
      value: (document) => document.formatIdentified ?? "",
    },
  ];
}

/** Newest document first, which is the read's own order. */
export const REVIEW_DOCUMENT_INITIAL_SORT = {
  columnId: "sortDate",
  direction: "descending",
} as const;
