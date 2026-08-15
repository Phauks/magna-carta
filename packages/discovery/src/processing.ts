// The processing stage's pure half: how an extraction's derived facts are stored, and what the
// per-document metadata sidecar holds. No binding, no clock, no bucket — the consumer in apps/worker
// supplies all three, and the map from an extraction failure to one of the exception codes below
// lives there too, because it joins this package's vocabulary to the extraction port's and neither
// package may depend on the other.

// Which engine read the document, as it is stored. A comma-joined list in the order the engines ran:
// `discovery-engine`, `discovery-engine,recognition`, `office-conversion,discovery-engine`.
//
// STORED AS ONE COLUMN RATHER THAN A TABLE, deliberately. It is read whenever the document is read
// and is never queried across the corpus by one of its members — "how many documents went through
// recognition" is a scan over an already-narrow review set, not a join anyone should pay a
// quarter-million-row side table for. The vocabulary is closed by the extraction port, and the
// separator is a comma because no engine name contains one.
export const EXTRACTION_ROUTE_SEPARATOR = ",";

export function formatExtractionRoute(route: readonly string[]): string | null {
  return route.length === 0 ? null : route.join(EXTRACTION_ROUTE_SEPARATOR);
}

export function parseExtractionRoute(stored: string | null): readonly string[] {
  return stored === null || stored === "" ? [] : stored.split(EXTRACTION_ROUTE_SEPARATOR);
}

// The per-document metadata sidecar. It goes to R2 rather than to a column or an
// entity-attribute-value table: a production's per-document metadata is open-ended, and at the
// ceiling a quarter-million documents times forty attributes is ten million rows bought to provide
// filtering the index does better.
//
// It holds NO TEXT. The text is its own object, and duplicating even a fragment of it here would put
// privileged content in a second place with its own lifecycle and its own answer to a deletion.
export interface ReviewDocumentSidecar {
  readonly reviewDocumentId: string;
  readonly reviewSetId: string;
  readonly discoveryLoadId: string;
  readonly formatIdentified: string | null;
  readonly pageCount: number | null;
  readonly documentDate: string | null;
  readonly documentDateSource: string | null;
  // Which engines produced the text, in the order they ran. The same fact the row carries, written
  // here too because the sidecar is what travels with a produced document and a row does not.
  readonly extractionRoute: readonly string[];
  // One entry per page: whether its words are the author's characters or a machine's reading of a
  // picture of them, and whether it produced anything at all. This is what makes "page 7 went to
  // recognition and came back empty" answerable years later.
  readonly pages: readonly ReviewDocumentPageFact[];
  readonly textFingerprint: string | null;
  readonly extractedAt: string;
}

export interface ReviewDocumentPageFact {
  readonly pageIndex: number;
  // `native` for the document's own characters, `ocr` for a recognizer's reading of a picture of
  // them. Two readings of one page are not the same evidence, and a corpus that could not tell them
  // apart could not say which of its text a person actually typed.
  readonly provenance: string;
  readonly hasText: boolean;
}

// How many of a document's pages are a machine's reading rather than the author's characters. Stored
// as a scalar beside the route because it is the number a reviewer judges the text by: a document
// whose every page was recognized reads differently from one whose text is exact, and a search hit in
// each means a different thing.
export function countRecognizedPages(pages: readonly ReviewDocumentPageFact[]): number {
  return pages.filter((page) => page.provenance === "ocr").length;
}
