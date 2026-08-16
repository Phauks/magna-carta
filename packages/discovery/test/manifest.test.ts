import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  DiscoveryLoadId,
  RecordCustodianId,
  ReviewDocumentId,
  ReviewSetId,
} from "@magna-carta/identifiers/types";
import type { LoadExceptionRow, ManifestDocumentRow } from "../src/manifest-statements.ts";
import {
  EXCEPTION_REPORT_EPILOGUE,
  LOAD_MANIFEST_EPILOGUE,
  exceptionReportEntry,
  exceptionReportPrelude,
  exceptionReportTextLine,
  exceptionReportTextPrelude,
  loadManifestDocumentEntry,
  loadManifestPrelude,
  loadManifestTextDocumentLine,
  loadManifestTextPrelude,
  type LoadArtifactContext,
} from "../src/manifest.ts";
import { REVIEW_DOCUMENT_EXCEPTION_CODES } from "../src/types.ts";

// AN EXCEPTION REPORT IS A LEGAL DOCUMENT ABOUT ABSENCE, and a manifest is a chain-of-custody
// continuation. Both are handed to another party, so the properties under test here are the two that
// make them worth handing over: the same load reported twice is the same document, and every code
// keeps its own sentence rather than collapsing into "failed".

function documentRow(overrides: Partial<ManifestDocumentRow> = {}): ManifestDocumentRow {
  return {
    id: "reviewDocument_manifest0000000000000" as ReviewDocumentId,
    record_custodian_id: "recordCustodian_manifest000000000000" as RecordCustodianId,
    source_kind: "file_version",
    source_name: "PLTF000001.pdf",
    source_path: "production/2026-03/PLTF000001.pdf",
    size_bytes: 88123,
    content_md5: "9e107d9d372bb6826bd81d3542a419d6",
    content_sha1: "2fd4e1c67a2d28fced849ee1bb76e7391b93eb12",
    content_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    family_id: "reviewDocument_manifest0000000000000" as ReviewDocumentId,
    family_role: "standalone",
    family_sequence: 0,
    page_count: 12,
    format_identified: "pdf",
    extraction_route: "discovery-engine,recognition",
    pages_recognized: 3,
    text_fingerprint: "9f2c1a04bb37de55",
    dedup_group_id: null,
    is_dedup_primary: 1,
    processing_state: "processed",
    sort_date: "2026-03-04T00:00:00Z",
    sort_date_source: "documentProperties",
    ...overrides,
  };
}

function exceptionRow(overrides: Partial<LoadExceptionRow> = {}): LoadExceptionRow {
  return {
    review_document_id: "reviewDocument_excepted00000000000000" as ReviewDocumentId,
    exception_id: "reviewDocumentException_first00000000",
    stage: "extract",
    code: "encrypted",
    detail: "the document's content is encrypted",
    created_at: "2026-08-16T09:00:00.000Z",
    record_custodian_id: "recordCustodian_manifest000000000000" as RecordCustodianId,
    source_name: "sealed.docx",
    source_path: "production/2026-03/sealed.docx",
    format_identified: "openXmlWordDocument",
    family_id: "reviewDocument_excepted00000000000000" as ReviewDocumentId,
    family_role: "standalone",
    processing_state: "excepted",
    is_dedup_primary: 1,
    ...overrides,
  };
}

const CONTEXT: LoadArtifactContext = {
  loadId: "discoveryLoad_manifest0000000000000" as DiscoveryLoadId,
  reviewSetId: "reviewSet_manifest000000000000000" as ReviewSetId,
  reviewSetName: "Plaintiff's production, March 2026",
  matterId: "matter_manifest000000000000",
  lane: "received-production",
  loadState: "complete",
  transcriptScope: "exclude",
  sourceDescription: "Delivered on a USB drive, 2026-03-04",
  initiatedBy: "user_manifest00000000000000",
  initiatedAt: "2026-03-04T10:00:00.000Z",
  knowledgeInstant: "2026-08-16T09:15:00.000Z",
  reconciliation: {
    declaredDocumentCount: 3,
    loadedDocumentCount: 3,
    processedCount: 2,
    exceptionCount: 1,
    declarationMatched: true,
    accountedFor: true,
  },
  recordCustodians: [
    { id: "recordCustodian_manifest000000000000", displayName: "A. Keeper", kind: "person" },
  ],
  exceptionCounts: [
    { code: "encrypted", document_count: 1 },
    { code: "password-protected", document_count: 1 },
  ],
  manifestKey: "discovery/reviewSet_manifest000000000000000/loads/x/manifest.json",
  exceptionReportKey: "discovery/reviewSet_manifest000000000000000/loads/x/exceptions.json",
  extractionRoutesObserved: ["discovery-engine", "recognition"],
};

function renderManifest(
  context: LoadArtifactContext,
  rows: readonly ManifestDocumentRow[],
): string {
  const entries = rows.map((row) =>
    loadManifestDocumentEntry({ document: row, recordCustodianName: "A. Keeper" }),
  );
  return loadManifestPrelude(context) + entries.join(",\n") + LOAD_MANIFEST_EPILOGUE;
}

function renderReport(context: LoadArtifactContext, rows: readonly LoadExceptionRow[]): string {
  return (
    exceptionReportPrelude(context) +
    rows.map((row) => exceptionReportEntry(row)).join(",\n") +
    EXCEPTION_REPORT_EPILOGUE
  );
}

describe("the same load reported twice is the same document", () => {
  it("renders byte-identically from the same inputs", () => {
    const rows = [
      documentRow(),
      documentRow({ id: "reviewDocument_second00000000000000" as ReviewDocumentId }),
    ];
    expect(renderManifest(CONTEXT, rows)).toBe(renderManifest(CONTEXT, rows));
    expect(renderReport(CONTEXT, [exceptionRow()])).toBe(renderReport(CONTEXT, [exceptionRow()]));
  });

  it("reads no clock, so a rebuild years later states what was known then", () => {
    // The instant is an ARGUMENT. A builder that reached for `now` would produce a different
    // document on every run, which is the difference between a record and a snapshot — and the
    // source scan is how that stays true, because a passing render proves nothing about a field
    // nobody looked at.
    const source = readFileSync(join(import.meta.dirname, "..", "src", "manifest.ts"), "utf8");
    expect(source).not.toMatch(/Date\.now|new Date\(/);
    expect(renderManifest(CONTEXT, [documentRow()])).toContain(CONTEXT.knowledgeInstant);
    expect(renderReport(CONTEXT, [exceptionRow()])).toContain(CONTEXT.knowledgeInstant);
  });

  it("is valid JSON that round-trips every field the corpus recorded", () => {
    const parsed = JSON.parse(renderManifest(CONTEXT, [documentRow()])) as {
      knowledgeInstant: string;
      load: { lane: string; transcriptScope: string };
      reconciliation: { accountedFor: boolean; loadedDocumentCount: number };
      documents: {
        reviewDocumentId: string;
        digests: { sha256: string; md5: string; sha1: string; legacyInterop: string[] };
        extractionRoute: string[];
        pagesRecognized: number;
        isDedupPrimary: boolean;
      }[];
    };
    expect(parsed.knowledgeInstant).toBe(CONTEXT.knowledgeInstant);
    expect(parsed.load.lane).toBe("received-production");
    expect(parsed.reconciliation.loadedDocumentCount).toBe(3);
    expect(parsed.documents).toHaveLength(1);
    // MD5 and SHA-1 are present because load-file specifications still ask for them, and they are
    // LABELLED as the legacy-interop values they are rather than offered as evidence of integrity.
    expect(parsed.documents[0]?.digests.legacyInterop).toEqual(["md5", "sha1"]);
    expect(parsed.documents[0]?.digests.sha256).toBe(documentRow().content_sha256);
    expect(parsed.documents[0]?.extractionRoute).toEqual(["discovery-engine", "recognition"]);
    expect(parsed.documents[0]?.pagesRecognized).toBe(3);
  });

  it("renders an empty load without producing something that is not JSON", () => {
    const parsed = JSON.parse(renderManifest(CONTEXT, [])) as { documents: unknown[] };
    expect(parsed.documents).toEqual([]);
  });
});

describe("every code keeps its own sentence", () => {
  it("renders the code the corpus recorded rather than a word standing in for several", () => {
    // `encrypted` and `password-protected` were kept apart because the REMEDY differs: a password
    // can be asked for and a key cannot. A report that folded them together would tell a firm to do
    // the wrong thing about half of them.
    const rows = [
      exceptionRow({ code: "encrypted" }),
      exceptionRow({
        review_document_id: "reviewDocument_locked00000000000000" as ReviewDocumentId,
        exception_id: "reviewDocumentException_second0000000",
        code: "password-protected",
        detail: "the document is locked with a user password",
      }),
    ];
    const rendered = renderReport(CONTEXT, rows);
    expect(rendered).toContain('"code": "encrypted"');
    expect(rendered).toContain('"code": "password-protected"');
    expect(rendered).not.toContain("failed to extract");
  });

  it("renders every code in the closed vocabulary without collapsing any of them", () => {
    const rows = REVIEW_DOCUMENT_EXCEPTION_CODES.map((code, index) =>
      exceptionRow({
        review_document_id:
          `reviewDocument_code${String(index).padStart(4, "0")}` as ReviewDocumentId,
        exception_id: `reviewDocumentException_${index}`,
        code,
      }),
    );
    const parsed = JSON.parse(renderReport(CONTEXT, rows)) as { exceptions: { code: string }[] };
    expect(parsed.exceptions.map((entry) => entry.code)).toEqual([
      ...REVIEW_DOCUMENT_EXCEPTION_CODES,
    ]);
  });

  it("states the document's terminal state beside its reason", () => {
    // A container whose entries were expanded and whose encrypted entries were not is a document
    // that PROCESSED and still owes the reader a sentence. The two facts are separate and both are
    // rendered, so nobody has to infer one from the other.
    const parsed = JSON.parse(
      renderReport(CONTEXT, [
        exceptionRow({ code: "encrypted-container-entry", processing_state: "processed" }),
      ]),
    ) as { exceptions: { code: string; processingState: string }[] };
    expect(parsed.exceptions[0]?.code).toBe("encrypted-container-entry");
    expect(parsed.exceptions[0]?.processingState).toBe("processed");
  });

  it("never says a document was indexed as empty", () => {
    // `no-text-extracted` exists precisely so a document that yields nothing is excepted rather than
    // indexed with an empty entry — an empty entry asserts "this document contains no text", the one
    // answer a discovery search must never give wrongly.
    const rendered = renderReport(CONTEXT, [
      exceptionRow({ code: "no-text-extracted", detail: "the document holds no text at all" }),
    ]);
    expect(rendered).toContain('"code": "no-text-extracted"');
  });
});

describe("the printable form is readable without tooling", () => {
  it("states the reconciliation and names every code with its count", () => {
    const text =
      exceptionReportTextPrelude(CONTEXT) +
      [exceptionRow()].map((row) => exceptionReportTextLine(row)).join("");
    expect(text).toContain("DISCOVERY EXCEPTION REPORT");
    expect(text).toContain("Loaded equals processed plus excepted: yes");
    expect(text).toContain("encrypted: 1");
    expect(text).toContain("password-protected: 1");
    expect(text).toContain("sealed.docx");
    // A document named in this report is IN the corpus, and the report says so in words rather than
    // leaving a reader to work it out.
    expect(text).toContain("it was received");
  });

  it("says out loud when a load does not reconcile", () => {
    const broken: LoadArtifactContext = {
      ...CONTEXT,
      reconciliation: { ...CONTEXT.reconciliation, accountedFor: false },
    };
    expect(exceptionReportTextPrelude(broken)).toContain(
      "Loaded equals processed plus excepted: NO",
    );
    expect(loadManifestTextPrelude(broken)).toContain("Loaded equals processed plus excepted: NO");
  });

  it("marks a suppressed copy as one, so a reader is not left wondering why it has no text", () => {
    const line = loadManifestTextDocumentLine({
      document: documentRow({ is_dedup_primary: 0, dedup_group_id: "content-sha256:abc" }),
      recordCustodianName: "A. Keeper",
    });
    expect(line).toContain("[duplicate copy, suppressed from review]");
  });
});
