import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { inspectDocx } from "../src/ooxml/inspect.ts";
import { scrubDocx } from "../src/ooxml/scrub.ts";
import { SCRUB_ALL } from "../src/options.ts";
import { buildDocx } from "./support/docx-fixture.ts";

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function bodyText(bytes: Uint8Array): string {
  return new TextDecoder().decode(unzipSync(bytes)["word/document.xml"]);
}

describe("scrubDocx — accept tracked changes", () => {
  it("keeps inserted text and drops the w:ins wrapper", () => {
    const document = `${DECL}<w:document ${W}><w:body><w:p><w:ins><w:r><w:t>added</w:t></w:r></w:ins></w:p></w:body></w:document>`;
    const out = scrubDocx(buildDocx({ document }), SCRUB_ALL);
    expect(bodyText(out)).toContain("added");
    expect(bodyText(out)).not.toContain("w:ins");
    expect(inspectDocx(out).findings.map((f) => f.category)).not.toContain("tracked-changes");
  });

  it("removes deleted text entirely", () => {
    const document = `${DECL}<w:document ${W}><w:body><w:p><w:r><w:t>keep</w:t></w:r><w:del><w:r><w:delText>gone</w:delText></w:r></w:del></w:p></w:body></w:document>`;
    const out = scrubDocx(buildDocx({ document }), SCRUB_ALL);
    expect(bodyText(out)).toContain("keep");
    expect(bodyText(out)).not.toContain("gone");
  });

  it("removes formatting-change records", () => {
    const document = `${DECL}<w:document ${W}><w:body><w:p><w:pPr><w:rPr><w:rPrChange w:id="1"><w:rPr/></w:rPrChange></w:rPr></w:pPr></w:p></w:body></w:document>`;
    const out = scrubDocx(buildDocx({ document }), SCRUB_ALL);
    expect(bodyText(out)).not.toContain("w:rPrChange");
  });

  it("drops deleted text nested inside an insertion", () => {
    // The worst case for a redaction tool: a deletion inside an insertion. The REMOVE guard must fire
    // before the UNWRAP recurse, so the deleted text never survives the hoist.
    const document = `${DECL}<w:document ${W}><w:body><w:p><w:ins><w:del><w:r><w:delText>gone</w:delText></w:r></w:del></w:ins></w:p></w:body></w:document>`;
    const out = scrubDocx(buildDocx({ document }), SCRUB_ALL);
    expect(bodyText(out)).not.toContain("gone");
    expect(bodyText(out)).not.toContain("w:ins");
    expect(bodyText(out)).not.toContain("w:del");
    expect(inspectDocx(out).findings.map((f) => f.category)).not.toContain("tracked-changes");
  });
});
