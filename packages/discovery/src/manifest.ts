import type {
  LoadExceptionCodeCount,
  LoadExceptionRow,
  ManifestDocumentRow,
} from "./manifest-statements.ts";
import { parseExtractionRoute } from "./processing.ts";
import type { DiscoveryLoadLane, DiscoveryLoadState } from "./types.ts";
import type { TranscriptScope } from "./load-source.ts";

// THE TWO RECORD ARTIFACTS, as pure text. No clock, no bucket, no database — every fact this module
// states is handed to it, which is what makes the artifacts reproducible rather than merely written
// once.
//
// REPRODUCIBILITY IS A PROPERTY OF THIS MODULE, and it is the reason the module exists at all.
// A manifest and an exception report are documents a firm hands to another party and may have to
// produce again years later; the same load, reported twice, must be the same document. Three rules
// make that true and all three are structural rather than remembered:
//
//   1. THE INSTANT IS AN ARGUMENT. Nothing here reads a clock. The caller passes the instant at which
//      the corpus stopped moving for this load, so the artifact states what was known THEN rather
//      than what is true when somebody happens to re-run it.
//   2. EVERY LIST ARRIVES ORDERED. The document walk and the exception walk are both keyset-paged by
//      identifier and the code counts are grouped in code order, so no set is rendered in whatever
//      order a query planner chose that day.
//   3. NOTHING IS DERIVED FROM THE ENVIRONMENT. No hostname, no build identifier, no locale-shaped
//      number or date. Numbers are written as digits and instants are written exactly as the corpus
//      stored them.
//
// A LOAD MANIFEST DESCRIBES WHAT ARRIVED and is never regenerated: a re-processing writes a new
// processing record, while what a party handed over does not change.
//
// AN EXCEPTION REPORT IS A LEGAL DOCUMENT ABOUT ABSENCE. It says "these documents exist, we could not
// read them, and here is why for each one". Every code in it is a different sentence to a court —
// `encrypted` and `password-protected` are kept apart because the remedy differs, and
// `no-text-extracted` exists precisely so that a document is never indexed as empty — so this module
// renders the code the corpus recorded and never a summary word standing in for several of them.

// Bumped when the shape changes in a way a reader could notice. A firm that produced last year's
// manifest and this year's should be able to say which shape each is.
export const LOAD_MANIFEST_SCHEMA_VERSION = 1;
export const EXCEPTION_REPORT_SCHEMA_VERSION = 1;

export interface RecordCustodianDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly kind: string;
}

export interface LoadArtifactContext {
  readonly loadId: string;
  readonly reviewSetId: string;
  readonly reviewSetName: string;
  readonly matterId: string;
  readonly lane: DiscoveryLoadLane;
  readonly loadState: DiscoveryLoadState;
  readonly transcriptScope: TranscriptScope;
  readonly sourceDescription: string | null;
  readonly initiatedBy: string;
  readonly initiatedAt: string;
  // The instant the corpus stopped moving for this load: every document in it had reached a terminal
  // state by then and nothing has changed since. Passed rather than read so a second run of the same
  // generation produces the same bytes.
  readonly knowledgeInstant: string;
  readonly reconciliation: {
    readonly declaredDocumentCount: number;
    readonly loadedDocumentCount: number;
    readonly processedCount: number;
    readonly exceptionCount: number;
    readonly declarationMatched: boolean;
    readonly accountedFor: boolean;
  };
  readonly recordCustodians: readonly RecordCustodianDescriptor[];
  readonly exceptionCounts: readonly LoadExceptionCodeCount[];
  readonly exceptionReportKey: string;
  readonly manifestKey: string;
  // The engines that actually read this load's documents, as the corpus itself recorded them on each
  // row. Drawn from the rows rather than from what was bound at deploy time: what read a document is
  // a fact about the document, and a deploy-time flag would state what COULD have read it.
  readonly extractionRoutesObserved: readonly string[];
}

export interface ManifestDocumentDescriptor {
  readonly document: ManifestDocumentRow;
  readonly recordCustodianName: string;
}

const INDENT = "    ";

function jsonString(value: string | null): string {
  return value === null ? "null" : JSON.stringify(value);
}

function jsonNumber(value: number | null): string {
  return value === null ? "null" : String(value);
}

// The manifest up to and including the opening of its document array. Everything a reader needs to
// judge the load — its provenance, its arithmetic, and who its records belonged to — is here, ahead
// of a list that may run to a quarter of a million entries.
export function loadManifestPrelude(context: LoadArtifactContext): string {
  const custodians = context.recordCustodians
    .map(
      (recordCustodian) =>
        `${INDENT}{ "id": ${JSON.stringify(recordCustodian.id)}, ` +
        `"displayName": ${JSON.stringify(recordCustodian.displayName)}, ` +
        `"kind": ${JSON.stringify(recordCustodian.kind)} }`,
    )
    .join(",\n");
  const counts = context.exceptionCounts
    .map(
      (count) =>
        `${INDENT}{ "code": ${JSON.stringify(count.code)}, ` +
        `"documentCount": ${count.document_count} }`,
    )
    .join(",\n");
  return (
    `{\n` +
    `  "artifact": "discovery-load-manifest",\n` +
    `  "schemaVersion": ${LOAD_MANIFEST_SCHEMA_VERSION},\n` +
    `  "knowledgeInstant": ${JSON.stringify(context.knowledgeInstant)},\n` +
    `  "load": {\n` +
    `    "id": ${JSON.stringify(context.loadId)},\n` +
    `    "reviewSetId": ${JSON.stringify(context.reviewSetId)},\n` +
    `    "reviewSetName": ${JSON.stringify(context.reviewSetName)},\n` +
    `    "matterId": ${JSON.stringify(context.matterId)},\n` +
    `    "lane": ${JSON.stringify(context.lane)},\n` +
    `    "state": ${JSON.stringify(context.loadState)},\n` +
    `    "transcriptScope": ${JSON.stringify(context.transcriptScope)},\n` +
    `    "sourceDescription": ${jsonString(context.sourceDescription)},\n` +
    `    "initiatedBy": ${JSON.stringify(context.initiatedBy)},\n` +
    `    "initiatedAt": ${JSON.stringify(context.initiatedAt)}\n` +
    `  },\n` +
    `  "reconciliation": {\n` +
    `    "declaredDocumentCount": ${context.reconciliation.declaredDocumentCount},\n` +
    `    "loadedDocumentCount": ${context.reconciliation.loadedDocumentCount},\n` +
    `    "processedCount": ${context.reconciliation.processedCount},\n` +
    `    "exceptionCount": ${context.reconciliation.exceptionCount},\n` +
    `    "declarationMatched": ${context.reconciliation.declarationMatched},\n` +
    `    "accountedFor": ${context.reconciliation.accountedFor}\n` +
    `  },\n` +
    `  "recordCustodians": [\n${custodians}${custodians === "" ? "" : "\n"}  ],\n` +
    `  "processing": {\n` +
    `    "extractionRoutesObserved": ${JSON.stringify(context.extractionRoutesObserved)}\n` +
    `  },\n` +
    `  "exceptionReport": {\n` +
    `    "key": ${JSON.stringify(context.exceptionReportKey)},\n` +
    `    "byCode": [\n${counts}${counts === "" ? "" : "\n"}    ]\n` +
    `  },\n` +
    `  "documents": [\n`
  );
}

// One document as it arrived, and what became of it. THE DIGESTS ARE THE POINT of this entry: they
// are how the receiving party checks that what it produced is what the corpus holds. MD5 and SHA-1
// are here because load-file specifications and opposing-party tooling still ask for them, and they
// are labelled legacy-interop exactly as @magna-carta/file-integrity labels them — they are not
// offered as evidence of integrity, SHA-256 is.
export function loadManifestDocumentEntry(entry: ManifestDocumentDescriptor): string {
  const row = entry.document;
  return (
    `${INDENT}{ "reviewDocumentId": ${JSON.stringify(row.id)}` +
    `, "sourceKind": ${JSON.stringify(row.source_kind)}` +
    `, "sourceName": ${jsonString(row.source_name)}` +
    `, "sourcePath": ${jsonString(row.source_path)}` +
    `, "sizeBytes": ${jsonNumber(row.size_bytes)}` +
    `, "recordCustodianId": ${JSON.stringify(row.record_custodian_id)}` +
    `, "recordCustodianName": ${JSON.stringify(entry.recordCustodianName)}` +
    `, "familyId": ${JSON.stringify(row.family_id)}` +
    `, "familyRole": ${JSON.stringify(row.family_role)}` +
    `, "familySequence": ${row.family_sequence}` +
    `, "digests": { "sha256": ${jsonString(row.content_sha256)}` +
    `, "md5": ${jsonString(row.content_md5)}` +
    `, "sha1": ${jsonString(row.content_sha1)}` +
    `, "legacyInterop": ["md5", "sha1"] }` +
    `, "processingState": ${JSON.stringify(row.processing_state)}` +
    `, "formatIdentified": ${jsonString(row.format_identified)}` +
    `, "extractionRoute": ${JSON.stringify(parseExtractionRoute(row.extraction_route))}` +
    `, "pageCount": ${jsonNumber(row.page_count)}` +
    `, "pagesRecognized": ${jsonNumber(row.pages_recognized)}` +
    `, "documentDate": ${jsonString(row.sort_date)}` +
    `, "documentDateSource": ${jsonString(row.sort_date_source)}` +
    `, "textFingerprint": ${jsonString(row.text_fingerprint)}` +
    `, "dedupGroupId": ${jsonString(row.dedup_group_id)}` +
    `, "isDedupPrimary": ${row.is_dedup_primary === 1} }`
  );
}

export const LOAD_MANIFEST_EPILOGUE = "\n  ]\n}\n";

// The printable sibling. A firm hands this to somebody with no tooling and no account, so it is
// plain text with one document per line and a header that reads as a statement rather than a dump.
export function loadManifestTextPrelude(context: LoadArtifactContext): string {
  const custodians =
    context.recordCustodians.length === 0
      ? "  (none recorded)\n"
      : context.recordCustodians
          .map((recordCustodian) => `  ${recordCustodian.displayName} (${recordCustodian.kind})\n`)
          .join("");
  const counts =
    context.exceptionCounts.length === 0
      ? "  (none)\n"
      : context.exceptionCounts
          .map((count) => `  ${count.code}: ${count.document_count}\n`)
          .join("");
  return (
    `DISCOVERY LOAD MANIFEST\n` +
    `=======================\n\n` +
    `Review set        ${context.reviewSetName}\n` +
    `Review set id     ${context.reviewSetId}\n` +
    `Matter            ${context.matterId}\n` +
    `Load              ${context.loadId}\n` +
    `Source lane       ${context.lane}\n` +
    `Source            ${context.sourceDescription ?? "(not stated)"}\n` +
    `Assistant transcripts  ${context.transcriptScope}\n` +
    `Initiated by      ${context.initiatedBy}\n` +
    `Initiated at      ${context.initiatedAt}\n` +
    `Reported as of    ${context.knowledgeInstant}\n\n` +
    `RECONCILIATION\n` +
    `  Declared    ${context.reconciliation.declaredDocumentCount}\n` +
    `  Loaded      ${context.reconciliation.loadedDocumentCount}\n` +
    `  Processed   ${context.reconciliation.processedCount}\n` +
    `  Excepted    ${context.reconciliation.exceptionCount}\n` +
    `  Loaded equals processed plus excepted: ` +
    `${context.reconciliation.accountedFor ? "yes" : "NO"}\n` +
    `  Declared count matched what arrived: ` +
    `${context.reconciliation.declarationMatched ? "yes" : "no"}\n\n` +
    `CUSTODIANS OF RECORD\n` +
    custodians +
    `\nEXCEPTIONS BY CODE (documents)\n` +
    counts +
    `\n  The exception report for this load is at ${context.exceptionReportKey}\n` +
    `\nDOCUMENTS\n` +
    `  Columns: review document id | custodian of record | family role | processing state | ` +
    `SHA-256 | name\n`
  );
}

export function loadManifestTextDocumentLine(entry: ManifestDocumentDescriptor): string {
  const row = entry.document;
  const suppressed = row.is_dedup_primary === 1 ? "" : " [duplicate copy, suppressed from review]";
  return (
    `  ${row.id} | ${entry.recordCustodianName} | ${row.family_role} | ${row.processing_state}` +
    ` | ${row.content_sha256 ?? "(no hash recorded)"} | ${row.source_name ?? "(unnamed)"}` +
    `${suppressed}\n`
  );
}

// ---------------------------------------------------------------------------------------------
// The exception report

export function exceptionReportPrelude(context: LoadArtifactContext): string {
  const counts = context.exceptionCounts
    .map(
      (count) =>
        `${INDENT}{ "code": ${JSON.stringify(count.code)}, ` +
        `"documentCount": ${count.document_count} }`,
    )
    .join(",\n");
  return (
    `{\n` +
    `  "artifact": "discovery-load-exception-report",\n` +
    `  "schemaVersion": ${EXCEPTION_REPORT_SCHEMA_VERSION},\n` +
    `  "knowledgeInstant": ${JSON.stringify(context.knowledgeInstant)},\n` +
    `  "load": {\n` +
    `    "id": ${JSON.stringify(context.loadId)},\n` +
    `    "reviewSetId": ${JSON.stringify(context.reviewSetId)},\n` +
    `    "reviewSetName": ${JSON.stringify(context.reviewSetName)},\n` +
    `    "matterId": ${JSON.stringify(context.matterId)},\n` +
    `    "lane": ${JSON.stringify(context.lane)},\n` +
    `    "initiatedAt": ${JSON.stringify(context.initiatedAt)}\n` +
    `  },\n` +
    `  "reconciliation": {\n` +
    `    "loadedDocumentCount": ${context.reconciliation.loadedDocumentCount},\n` +
    `    "processedCount": ${context.reconciliation.processedCount},\n` +
    `    "exceptionCount": ${context.reconciliation.exceptionCount},\n` +
    `    "accountedFor": ${context.reconciliation.accountedFor}\n` +
    `  },\n` +
    `  "manifest": { "key": ${JSON.stringify(context.manifestKey)} },\n` +
    `  "byCode": [\n${counts}${counts === "" ? "" : "\n"}  ],\n` +
    `  "exceptions": [\n`
  );
}

// One reason one document could not be read. The code is rendered exactly as the corpus recorded it
// — never folded into a broader word — and the document's terminal state is rendered beside it,
// because the two are different facts: a container whose entries were expanded and whose encrypted
// entries were not is a document that PROCESSED and still owes the reader a sentence.
export function exceptionReportEntry(row: LoadExceptionRow): string {
  return (
    `${INDENT}{ "reviewDocumentId": ${JSON.stringify(row.review_document_id)}` +
    `, "sourceName": ${jsonString(row.source_name)}` +
    `, "sourcePath": ${jsonString(row.source_path)}` +
    `, "recordCustodianId": ${JSON.stringify(row.record_custodian_id)}` +
    `, "familyId": ${JSON.stringify(row.family_id)}` +
    `, "familyRole": ${JSON.stringify(row.family_role)}` +
    `, "formatIdentified": ${jsonString(row.format_identified)}` +
    `, "stage": ${JSON.stringify(row.stage)}` +
    `, "code": ${JSON.stringify(row.code)}` +
    `, "detail": ${jsonString(row.detail)}` +
    `, "processingState": ${JSON.stringify(row.processing_state)}` +
    `, "isDedupPrimary": ${row.is_dedup_primary === 1}` +
    `, "raisedAt": ${JSON.stringify(row.created_at)} }`
  );
}

export const EXCEPTION_REPORT_EPILOGUE = "\n  ]\n}\n";

export function exceptionReportTextPrelude(context: LoadArtifactContext): string {
  const counts =
    context.exceptionCounts.length === 0
      ? "  (none — every document in this load was read)\n"
      : context.exceptionCounts
          .map((count) => `  ${count.code}: ${count.document_count}\n`)
          .join("");
  return (
    `DISCOVERY EXCEPTION REPORT\n` +
    `==========================\n\n` +
    `This report lists the documents in one load that the platform could not read, and states for ` +
    `each\none the reason it could not. A document named here is IN the corpus: it was received, ` +
    `it was\nrecorded, and it was not discarded.\n\n` +
    `Review set        ${context.reviewSetName}\n` +
    `Review set id     ${context.reviewSetId}\n` +
    `Matter            ${context.matterId}\n` +
    `Load              ${context.loadId}\n` +
    `Source lane       ${context.lane}\n` +
    `Initiated at      ${context.initiatedAt}\n` +
    `Reported as of    ${context.knowledgeInstant}\n\n` +
    `RECONCILIATION\n` +
    `  Loaded      ${context.reconciliation.loadedDocumentCount}\n` +
    `  Processed   ${context.reconciliation.processedCount}\n` +
    `  Excepted    ${context.reconciliation.exceptionCount}\n` +
    `  Loaded equals processed plus excepted: ` +
    `${context.reconciliation.accountedFor ? "yes" : "NO"}\n\n` +
    `DOCUMENTS BY CODE\n` +
    counts +
    `\n  The manifest for this load is at ${context.manifestKey}\n` +
    `\nEXCEPTIONS\n` +
    `  Columns: review document id | code | stage | processing state | name | detail\n`
  );
}

export function exceptionReportTextLine(row: LoadExceptionRow): string {
  return (
    `  ${row.review_document_id} | ${row.code} | ${row.stage} | ${row.processing_state}` +
    ` | ${row.source_name ?? "(unnamed)"} | ${row.detail ?? "(no further detail)"}\n`
  );
}
