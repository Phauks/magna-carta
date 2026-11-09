// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";
import { REVIEW_DOCUMENT_EXCEPTION_CODES } from "@magna-carta/discovery/types";
import { EXTRACTION_FAILURE_CODES } from "@magna-carta/search/extraction";
import {
  exceptionForExtractionFailure,
  mappedExtractionFailureCodes,
  MALWARE_FLAGGED,
  SOURCE_BYTES_MISSING,
} from "../src/discovery/extraction-exceptions.ts";

// The structural proof that a document cannot end in neither terminal state because the pipeline had
// no name for what happened to it. The map is checked against the extraction port's OWN exported
// vocabulary rather than a copy, so a failure code added there fails here on the same commit — which
// is the only way a totality claim survives a change nobody remembers to check.

describe("every extraction failure has an exception a firm can hand to opposing counsel", () => {
  it("maps every one of the port's failure codes", () => {
    const mapped = new Set(mappedExtractionFailureCodes());
    for (const code of EXTRACTION_FAILURE_CODES) {
      expect(mapped.has(code), `${code} has no exception code`).toBe(true);
    }
  });

  it("maps nothing the port cannot produce", () => {
    // The other direction. An entry with no code behind it is a reason the report could never print,
    // and a reader would take its absence from a report as evidence rather than as dead configuration.
    const produced = new Set<string>(EXTRACTION_FAILURE_CODES);
    for (const code of mappedExtractionFailureCodes()) {
      expect(produced.has(code), `${code} is mapped but no extraction can produce it`).toBe(true);
    }
  });

  it("only ever produces codes the schema will accept", () => {
    // The exception table's CHECK is the closed set. A code this map invented would abort the batch
    // that recorded it, which turns an honest exception into a dead-lettered message.
    const allowed = new Set<string>(REVIEW_DOCUMENT_EXCEPTION_CODES);
    for (const code of EXTRACTION_FAILURE_CODES) {
      expect(allowed.has(exceptionForExtractionFailure(code).code)).toBe(true);
    }
    expect(allowed.has(MALWARE_FLAGGED.code)).toBe(true);
    expect(allowed.has(SOURCE_BYTES_MISSING.code)).toBe(true);
  });

  it("keeps encrypted apart from password-protected, because the remedy differs", () => {
    // A password can be asked for and a key cannot. A firm working an exception report acts on that
    // difference, so collapsing the two would cost real work in the review room.
    expect(exceptionForExtractionFailure("encrypted").code).toBe("encrypted");
    expect(exceptionForExtractionFailure("passwordProtected").code).toBe("password-protected");
  });

  it("blames identification, not extraction, for a format nothing reads", () => {
    // The document never reached an extractor. Recording the stage as `extract` would say the
    // platform tried to read it and could not, which is a different and less honest sentence.
    expect(exceptionForExtractionFailure("unsupportedFormat").stage).toBe("identify");
  });

  it("says a container was not expanded rather than that it held no words", () => {
    expect(exceptionForExtractionFailure("needsExpansion").code).toBe("container-not-expanded");
  });

  it("records a quarantined document at the LOAD stage — no parser ever looked at it", () => {
    expect(MALWARE_FLAGGED.stage).toBe("load");
  });
});
