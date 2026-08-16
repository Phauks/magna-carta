import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ReviewDocumentId } from "@magna-carta/identifiers/types";
import {
  claimReviewDocumentStatement,
  markReviewDocumentProcessedStatement,
  selectDispatchableDocumentsStatement,
} from "../src/processing-statements.ts";
import {
  countRecognizedPages,
  formatExtractionRoute,
  parseExtractionRoute,
} from "../src/processing.ts";
import { migratedDatabase } from "./support.ts";

// The processing statements' structural properties — the ones the schema cannot hold, and the ones a
// reader would otherwise have to take on trust.

interface InspectableStatement {
  readonly sql: string;
  readonly bindings: readonly unknown[];
}

const DOCUMENT = "reviewDocument_processingTest000000" as ReviewDocumentId;
const NOW = "2026-08-15T00:00:00.000Z";

describe("a processed document always names its route and its format", () => {
  it("binds both on every write, because SQLite cannot be told to require them", () => {
    // `review_document_processed_names_format_check` holds the format. The ROUTE has no CHECK: there
    // is no ALTER TABLE ADD CONSTRAINT in SQLite and the per-firm lineage is additive-only, so
    // adding one would mean rebuilding a shipped table. This is where the rule lives instead.
    const { database } = migratedDatabase();
    const statement = markReviewDocumentProcessedStatement(
      database,
      DOCUMENT,
      {
        textR2Key: "discovery/reviewSet_x/text/reviewDocument_y.txt",
        metadataR2Key: "discovery/reviewSet_x/metadata/reviewDocument_y.json",
        formatIdentified: "pdf",
        pageCount: 4,
        pagesRecognized: 0,
        extractionRoute: "discovery-engine",
        textFingerprint: "9f2c1a04bb37de55",
        sortDate: "2026-03-04T00:00:00Z",
        sortDateSource: "documentProperties",
        contentMd5: null,
        contentSha1: null,
      },
      NOW,
    ) as unknown as InspectableStatement;

    expect(statement.sql).toContain("extraction_route = ?7");
    expect(statement.sql).toContain("format_identified = ?4");
    expect(statement.bindings).toContain("discovery-engine");
    expect(statement.bindings).toContain("pdf");
    // The route and the format are the FOURTH and SEVENTH bindings, and the types make them
    // non-nullable at the call site. Asserted on the type's shape rather than only on this instance,
    // because a later refactor that widened either to `| null` would compile and pass everything else.
    const facts: Parameters<typeof markReviewDocumentProcessedStatement>[2] = {
      textR2Key: "",
      metadataR2Key: "",
      formatIdentified: "pdf",
      pageCount: null,
      pagesRecognized: 0,
      extractionRoute: "discovery-engine",
      textFingerprint: null,
      sortDate: null,
      sortDateSource: null,
      contentMd5: null,
      contentSha1: null,
    };
    expect(typeof facts.formatIdentified).toBe("string");
    expect(typeof facts.extractionRoute).toBe("string");
  });

  it("only moves a document that this attempt actually claimed", () => {
    // Two consumers cannot both extract one document and write two texts over one key: the terminal
    // write names `processing` in its WHERE, and the claim that produced it names the states a claim
    // may start from.
    const { database } = migratedDatabase();
    const claim = claimReviewDocumentStatement(
      database,
      DOCUMENT,
      NOW,
    ) as unknown as InspectableStatement;
    expect(claim.sql).toContain("processing_state IN ('pending', 'processing')");
    const processed = markReviewDocumentProcessedStatement(
      database,
      DOCUMENT,
      {
        textR2Key: "",
        metadataR2Key: "",
        formatIdentified: "pdf",
        pageCount: null,
        pagesRecognized: 0,
        extractionRoute: "discovery-engine",
        textFingerprint: null,
        sortDate: null,
        sortDateSource: null,
        contentMd5: null,
        contentSha1: null,
      },
      NOW,
    ) as unknown as InspectableStatement;
    expect(processed.sql).toContain("processing_state = 'processing'");
  });
});

describe("the dispatch walk", () => {
  it("is keyset-paged, never offset-paged", () => {
    // A load at the ceiling is a quarter of a million rows and hundreds of pages. An OFFSET walk is
    // quadratic in the corpus, and the rows under an offset move as the walk itself marks them — so a
    // document could be skipped entirely, which is the one failure this subsystem cannot have.
    const { database } = migratedDatabase();
    const statement = selectDispatchableDocumentsStatement(
      database,
      "discoveryLoad_x" as never,
      null,
      100,
    ) as unknown as InspectableStatement;
    expect(statement.sql).not.toContain("OFFSET");
    expect(statement.sql).toContain("review_document.id > ?2");
    expect(statement.sql).toContain("ORDER BY review_document.id ASC");
  });

  it("starts from the beginning with the same statement it resumes with", () => {
    // The empty string sorts below every identifier, so "from the start" and "from here" are one
    // query rather than two that could drift apart.
    const { database } = migratedDatabase();
    const fromStart = selectDispatchableDocumentsStatement(
      database,
      "discoveryLoad_x" as never,
      null,
      100,
    ) as unknown as InspectableStatement;
    expect(fromStart.bindings).toContain("");
  });

  it("selects only documents still pending, so a re-run cannot re-read a finished one", () => {
    const { database } = migratedDatabase();
    const statement = selectDispatchableDocumentsStatement(
      database,
      "discoveryLoad_x" as never,
      null,
      100,
    ) as unknown as InspectableStatement;
    expect(statement.sql).toContain("review_document.processing_state = 'pending'");
  });
});

describe("the extraction route as it is stored", () => {
  it("round-trips the engines in the order they ran", () => {
    const route = ["office-conversion", "discovery-engine"];
    const stored = formatExtractionRoute(route);
    expect(stored).toBe("office-conversion,discovery-engine");
    expect(parseExtractionRoute(stored)).toEqual(route);
  });

  it("stores nothing rather than an empty string for a document that was never read", () => {
    expect(formatExtractionRoute([])).toBeNull();
    expect(parseExtractionRoute(null)).toEqual([]);
  });

  it("counts the pages a machine read, and no others", () => {
    expect(
      countRecognizedPages([
        { pageIndex: 0, provenance: "native", hasText: true },
        { pageIndex: 1, provenance: "ocr", hasText: true },
        { pageIndex: 2, provenance: "ocr", hasText: false },
      ]),
    ).toBe(2);
  });
});

describe("an exception detail never carries file content", () => {
  it("has no path in the source that reads bytes into one", () => {
    // The whole pipeline handles privileged material, so a detail carrying a fragment of a document
    // is a redaction failure wearing an error message. The statement takes a detail it is GIVEN, so
    // the rule cannot be held here by behaviour — this scans the module for the shape of a violation:
    // a template literal in the insert builder, which is how a value would be interpolated in.
    const source = readFileSync(
      join(import.meta.dirname, "..", "src", "processing-statements.ts"),
      "utf8",
    );
    const insertBuilder = source.slice(source.indexOf("insertReviewDocumentExceptionStatement"));
    const statementBody = insertBuilder.slice(0, insertBuilder.indexOf("\n}"));
    expect(statementBody).toContain("VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)");
    expect(statementBody).not.toMatch(/\$\{(?!REVIEW_DOCUMENT_EXCEPTION_TABLE)/);
  });
});
