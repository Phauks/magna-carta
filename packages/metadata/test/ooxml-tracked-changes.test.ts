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

  it("removes move-range markers along with the moved content wrappers", () => {
    // A move is recorded four ways: the origin (w:moveFrom), the destination (w:moveTo), and an
    // empty range marker at each end of both. The markers carry the reviser's name, the date, and
    // the move's bookmark name, so leaving them behind narrates the move in a document reported
    // clean.
    const document =
      `${DECL}<w:document ${W}><w:body><w:p>` +
      `<w:moveFromRangeStart w:id="1" w:name="move1" w:author="Reviewer Name" w:date="2024-01-01T00:00:00Z"/>` +
      `<w:moveFrom w:id="2" w:author="Reviewer Name"><w:r><w:delText>relocated</w:delText></w:r></w:moveFrom>` +
      `<w:moveFromRangeEnd w:id="1"/>` +
      `<w:moveToRangeStart w:id="3" w:name="move1" w:author="Reviewer Name" w:date="2024-01-01T00:00:00Z"/>` +
      `<w:moveTo w:id="4" w:author="Reviewer Name"><w:r><w:t>relocated</w:t></w:r></w:moveTo>` +
      `<w:moveToRangeEnd w:id="3"/>` +
      `</w:p></w:body></w:document>`;
    const source = buildDocx({ document });
    expect(inspectDocx(source).findings.map((f) => f.category)).toContain("tracked-changes");

    const out = scrubDocx(source, SCRUB_ALL);
    const body = bodyText(out);
    expect(body).toContain("relocated"); // the destination content is kept exactly once
    expect(body.match(/relocated/g)).toHaveLength(1);
    expect(body).not.toContain("moveFrom");
    expect(body).not.toContain("moveTo");
    expect(body).not.toContain("Reviewer Name");
    expect(body).not.toContain("2024-01-01");
    expect(inspectDocx(out).findings.map((f) => f.category)).not.toContain("tracked-changes");
  });

  it("removes custom-XML revision range markers", () => {
    const document =
      `${DECL}<w:document ${W}><w:body><w:p>` +
      `<w:customXmlInsRangeStart w:id="1" w:author="Reviewer Name" w:date="2024-01-01T00:00:00Z"/>` +
      `<w:customXmlDelRangeStart w:id="2" w:author="Reviewer Name"/>` +
      `<w:customXmlMoveFromRangeStart w:id="3" w:author="Reviewer Name"/>` +
      `<w:customXmlMoveToRangeEnd w:id="4"/>` +
      `<w:r><w:t>body</w:t></w:r></w:p></w:body></w:document>`;
    const source = buildDocx({ document });
    expect(inspectDocx(source).findings.map((f) => f.category)).toContain("tracked-changes");
    const out = scrubDocx(source, SCRUB_ALL);
    expect(bodyText(out)).toContain("body");
    expect(bodyText(out)).not.toContain("customXml");
    expect(bodyText(out)).not.toContain("Reviewer Name");
  });

  it("removes every property-change record class", () => {
    const document =
      `${DECL}<w:document ${W}><w:body>` +
      `<w:tbl><w:tblPr><w:tblPrChange w:id="1" w:author="A"><w:tblPr/></w:tblPrChange></w:tblPr>` +
      `<w:tr><w:trPr><w:trPrChange w:id="2" w:author="A"><w:trPr/></w:trPrChange></w:trPr>` +
      `<w:tc><w:tcPr><w:tcPrChange w:id="3" w:author="A"><w:tcPr/></w:tcPrChange></w:tcPr>` +
      `<w:p><w:pPr><w:pPrChange w:id="4" w:author="A"><w:pPr/></w:pPrChange></w:pPr>` +
      `<w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
      `<w:p><w:pPr><w:numPr><w:numberingChange w:id="5" w:author="A"/></w:numPr></w:pPr></w:p>` +
      `<w:sectPr><w:sectPrChange w:id="6" w:author="A"><w:sectPr/></w:sectPrChange></w:sectPr>` +
      `</w:body></w:document>`;
    const source = buildDocx({ document });
    expect(inspectDocx(source).findings.map((f) => f.category)).toContain("tracked-changes");
    const out = scrubDocx(source, SCRUB_ALL);
    const body = bodyText(out);
    expect(body).toContain("cell"); // the formatted content survives; only the record goes
    for (const record of [
      "tblPrChange",
      "trPrChange",
      "tcPrChange",
      "pPrChange",
      "numberingChange",
      "sectPrChange",
    ]) {
      expect(body).not.toContain(record);
    }
    expect(inspectDocx(out).findings.map((f) => f.category)).not.toContain("tracked-changes");
  });

  it("accepts a tracked row deletion by removing the row, not just its marker", () => {
    const document =
      `${DECL}<w:document ${W}><w:body><w:tbl>` +
      `<w:tr><w:tc><w:p><w:r><w:t>kept row</w:t></w:r></w:p></w:tc></w:tr>` +
      `<w:tr><w:trPr><w:del w:id="1" w:author="A" w:date="2024-01-01T00:00:00Z"/></w:trPr>` +
      `<w:tc><w:p><w:r><w:t>deleted row</w:t></w:r></w:p></w:tc></w:tr>` +
      `</w:tbl></w:body></w:document>`;
    const out = scrubDocx(buildDocx({ document }), SCRUB_ALL);
    expect(bodyText(out)).toContain("kept row");
    expect(bodyText(out)).not.toContain("deleted row");
  });

  it("accepts a tracked cell deletion by removing the cell", () => {
    const document =
      `${DECL}<w:document ${W}><w:body><w:tbl><w:tr>` +
      `<w:tc><w:p><w:r><w:t>kept cell</w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:tcPr><w:cellDel w:id="1" w:author="A"/></w:tcPr>` +
      `<w:p><w:r><w:t>deleted cell</w:t></w:r></w:p></w:tc>` +
      `</w:tr></w:tbl></w:body></w:document>`;
    const out = scrubDocx(buildDocx({ document }), SCRUB_ALL);
    expect(bodyText(out)).toContain("kept cell");
    expect(bodyText(out)).not.toContain("deleted cell");
  });

  it("keeps an inserted or merged cell and drops only its revision marker", () => {
    const document =
      `${DECL}<w:document ${W}><w:body><w:tbl><w:tr>` +
      `<w:tc><w:tcPr><w:cellIns w:id="1" w:author="Reviewer Name"/></w:tcPr>` +
      `<w:p><w:r><w:t>added cell</w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:tcPr><w:cellMerge w:id="2" w:author="Reviewer Name" w:vMerge="cont"/></w:tcPr>` +
      `<w:p><w:r><w:t>merged cell</w:t></w:r></w:p></w:tc>` +
      `</w:tr></w:tbl></w:body></w:document>`;
    const out = scrubDocx(buildDocx({ document }), SCRUB_ALL);
    const body = bodyText(out);
    expect(body).toContain("added cell");
    expect(body).toContain("merged cell");
    expect(body).not.toContain("cellIns");
    expect(body).not.toContain("cellMerge");
    expect(body).not.toContain("Reviewer Name");
    expect(inspectDocx(out).findings.map((f) => f.category)).not.toContain("tracked-changes");
  });

  it("removes the revision markers on an inserted and a deleted paragraph mark", () => {
    const document =
      `${DECL}<w:document ${W}><w:body>` +
      `<w:p><w:pPr><w:rPr><w:ins w:id="1" w:author="Reviewer Name" w:date="2024-01-01T00:00:00Z"/></w:rPr></w:pPr>` +
      `<w:r><w:t>first</w:t></w:r></w:p>` +
      `<w:p><w:pPr><w:rPr><w:del w:id="2" w:author="Reviewer Name"/></w:rPr></w:pPr>` +
      `<w:r><w:t>second</w:t></w:r></w:p>` +
      `</w:body></w:document>`;
    const out = scrubDocx(buildDocx({ document }), SCRUB_ALL);
    const body = bodyText(out);
    expect(body).toContain("first");
    expect(body).toContain("second");
    expect(body).not.toContain("Reviewer Name");
    expect(inspectDocx(out).findings.map((f) => f.category)).not.toContain("tracked-changes");
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
