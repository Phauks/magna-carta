import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { inspectDocx } from "../src/ooxml/inspect.ts";
import { scrubDocx } from "../src/ooxml/scrub.ts";
import { SCRUB_ALL } from "../src/options.ts";
import { buildDocx } from "./support/docx-fixture.ts";

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const RELS_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const TYPES_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/content-types"';
const REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function partNames(bytes: Uint8Array): string[] {
  return Object.keys(unzipSync(bytes));
}
function partText(bytes: Uint8Array, name: string): string {
  const raw = unzipSync(bytes)[name];
  return raw === undefined ? "" : new TextDecoder().decode(raw);
}
function categories(bytes: Uint8Array): Set<string> {
  return new Set(inspectDocx(bytes).findings.map((f) => f.category));
}

describe("whole parts outside the document body", () => {
  it("reports and removes the page-one preview image, its content type, and its relationship", () => {
    const rels =
      `${DECL}<Relationships ${RELS_NS}>` +
      `<Relationship Id="rId1" Type="${REL_TYPE}/officeDocument" Target="word/document.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail" Target="docProps/thumbnail.jpeg"/>` +
      `</Relationships>`;
    const contentTypes =
      `${DECL}<Types ${TYPES_NS}>` +
      `<Default Extension="jpeg" ContentType="image/jpeg"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `<Override PartName="/docProps/thumbnail.jpeg" ContentType="image/jpeg"/>` +
      `</Types>`;
    // A stand-in for the rendered preview: its bytes are opaque to every XML transform.
    const thumbnail = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const source = buildDocx({
      rels,
      contentTypes,
      extra: { "docProps/thumbnail.jpeg": thumbnail },
    });

    expect(categories(source)).toContain("embedded-preview");

    const out = scrubDocx(source, SCRUB_ALL);
    expect(partNames(out)).not.toContain("docProps/thumbnail.jpeg");
    expect(partText(out, "[Content_Types].xml")).not.toContain("thumbnail");
    expect(partText(out, "_rels/.rels")).not.toContain("thumbnail");
    expect(partText(out, "_rels/.rels")).toContain("word/document.xml"); // the real content survives
    expect(categories(out)).not.toContain("embedded-preview");
  });

  it("reports and removes embedded custom XML data and the relationship reaching it", () => {
    const documentRels =
      `${DECL}<Relationships ${RELS_NS}>` +
      `<Relationship Id="rId5" Type="${REL_TYPE}/customXml" Target="../customXml/item1.xml"/>` +
      `</Relationships>`;
    const source = buildDocx({
      documentRels,
      extra: {
        "customXml/item1.xml": `${DECL}<matter xmlns="urn:firm:dms"><client>Acme Corporation</client><number>2024-0117</number></matter>`,
        "customXml/itemProps1.xml": `${DECL}<ds:datastoreItem xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml" ds:itemID="{D1}"/>`,
        "customXml/_rels/item1.xml.rels": `${DECL}<Relationships ${RELS_NS}><Relationship Id="rId1" Type="${REL_TYPE}/customXmlProps" Target="itemProps1.xml"/></Relationships>`,
      },
    });

    expect(categories(source)).toContain("embedded-data");

    const out = scrubDocx(source, SCRUB_ALL);
    expect(partNames(out).some((name) => name.startsWith("customXml/"))).toBe(false);
    // The relationship is matched by resolved target ("../customXml/item1.xml" from word/), so it
    // goes with the part rather than leaving a reference to something no longer in the package.
    expect(partText(out, "word/_rels/document.xml.rels")).not.toContain("customXml");
    expect(categories(out)).not.toContain("embedded-data");
  });

  it("reports and removes stored variables, the mail-merge data source, and the template path", () => {
    const settings =
      `${DECL}<w:settings ${W} ${R}>` +
      `<w:attachedTemplate r:id="rId1"/>` +
      `<w:mailMerge><w:mainDocumentType w:val="formLetters"/><w:dataSource r:id="rId2"/></w:mailMerge>` +
      `<w:docVars><w:docVar w:name="ClientMatter" w:val="Acme Corporation / 2024-0117"/></w:docVars>` +
      `<w:rsids><w:rsidRoot w:val="00A1B2C3"/><w:rsid w:val="00A1B2C3"/><w:rsid w:val="00D4E5F6"/></w:rsids>` +
      `</w:settings>`;
    const settingsRels =
      `${DECL}<Relationships ${RELS_NS}>` +
      `<Relationship Id="rId1" Type="${REL_TYPE}/attachedTemplate" Target="file:///\\\\firm-server\\Templates\\Engagement.dotx" TargetMode="External"/>` +
      `<Relationship Id="rId2" Type="${REL_TYPE}/mailMergeSource" Target="file:///\\\\firm-server\\Clients\\AcmeList.xlsx" TargetMode="External"/>` +
      `</Relationships>`;
    const source = buildDocx({
      settings,
      extra: { "word/_rels/settings.xml.rels": settingsRels },
    });

    const before = categories(source);
    expect(before).toContain("document-settings");
    expect(before).toContain("edit-history");

    const out = scrubDocx(source, SCRUB_ALL);
    const scrubbedSettings = partText(out, "word/settings.xml");
    expect(scrubbedSettings).not.toContain("docVar");
    expect(scrubbedSettings).not.toContain("mailMerge");
    expect(scrubbedSettings).not.toContain("attachedTemplate");
    expect(scrubbedSettings).not.toContain("rsid");
    expect(scrubbedSettings).not.toContain("Acme Corporation");
    // The paths themselves live in the relationship targets, so those go too.
    const scrubbedRels = partText(out, "word/_rels/settings.xml.rels");
    expect(scrubbedRels).not.toContain("firm-server");
    const after = categories(out);
    expect(after).not.toContain("document-settings");
    expect(after).not.toContain("edit-history");
  });

  it("reports and removes revision save identifiers across every word-processing part", () => {
    const document =
      `${DECL}<w:document ${W}><w:body>` +
      `<w:p w:rsidR="00A1B2C3" w:rsidRDefault="00A1B2C3" w:rsidP="00D4E5F6">` +
      `<w:r w:rsidRPr="00A1B2C3"><w:t>Visible body text.</w:t></w:r></w:p>` +
      `</w:body></w:document>`;
    const styles =
      `${DECL}<w:styles ${W}><w:style w:type="paragraph" w:styleId="Normal">` +
      `<w:name w:val="Normal"/><w:rsid w:val="00A1B2C3"/></w:style></w:styles>`;
    const source = buildDocx({ document, styles });

    expect(categories(source)).toContain("edit-history");

    const out = scrubDocx(source, SCRUB_ALL);
    expect(partText(out, "word/document.xml")).toContain("Visible body text.");
    expect(partText(out, "word/document.xml")).not.toContain("rsid");
    expect(partText(out, "word/styles.xml")).not.toContain("rsid");
    expect(partText(out, "word/styles.xml")).toContain("Normal"); // the style itself is untouched
    expect(categories(out)).not.toContain("edit-history");
  });
});

describe("package integrity when parts are removed", () => {
  it("keeps an external hyperlink whose address merely ends in a removed part name", () => {
    const documentRels =
      `${DECL}<Relationships ${RELS_NS}>` +
      `<Relationship Id="rId1" Type="${REL_TYPE}/comments" Target="comments.xml"/>` +
      `<Relationship Id="rId2" Type="${REL_TYPE}/hyperlink" Target="https://example.com/docs/comments.xml" TargetMode="External"/>` +
      `</Relationships>`;
    const comments = `${DECL}<w:comments ${W}><w:comment w:id="1" w:author="R"><w:p><w:r><w:t>note</w:t></w:r></w:p></w:comment></w:comments>`;
    const out = scrubDocx(buildDocx({ documentRels, comments }), SCRUB_ALL);
    const rels = partText(out, "word/_rels/document.xml.rels");
    // Removing the hyperlink would leave the r:id in the body pointing at nothing, which is what
    // makes a reader declare the document damaged.
    expect(rels).toContain("https://example.com/docs/comments.xml");
    expect(rels).not.toContain('Target="comments.xml"');
  });

  it("removes the content-type override of every part it drops", () => {
    const contentTypes =
      `${DECL}<Types ${TYPES_NS}>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>` +
      `<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>` +
      `</Types>`;
    const comments = `${DECL}<w:comments ${W}><w:comment w:id="1" w:author="R"><w:p><w:r><w:t>note</w:t></w:r></w:p></w:comment></w:comments>`;
    const custom = `${DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Matter"><vt:lpwstr xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">Privileged</vt:lpwstr></property></Properties>`;
    const out = scrubDocx(buildDocx({ contentTypes, comments, custom }), SCRUB_ALL);
    const types = partText(out, "[Content_Types].xml");
    expect(types).toContain("/word/document.xml");
    expect(types).not.toContain("/word/comments.xml");
    expect(types).not.toContain("/docProps/custom.xml");
  });

  it("carries escaped characters and preserved whitespace through a rewrite intact", () => {
    // Every rewritten part is re-serialized, so the scrub is only safe if the round-trip is exact:
    // a mangled escape or a dropped space is a corrupted document handed back as a cleaned one.
    const document =
      `${DECL}<w:document ${W}><w:body><w:p>` +
      `<w:r><w:t xml:space="preserve">Smith &amp; Wesson v. &lt;Redacted&gt;  </w:t></w:r>` +
      `<w:r><w:t xml:space="preserve">trailing</w:t></w:r>` +
      `</w:p></w:body></w:document>`;
    const out = scrubDocx(buildDocx({ document }), SCRUB_ALL);
    const text = partText(out, "word/document.xml");
    expect(text).toContain("Smith &amp; Wesson v. &lt;Redacted&gt;  ");
    expect(text).toContain('xml:space="preserve"');
  });

  it("writes every rewritten part with a single XML declaration", () => {
    const out = scrubDocx(buildDocx(), SCRUB_ALL);
    for (const name of ["word/document.xml", "word/_rels/document.xml.rels", "docProps/core.xml"]) {
      const text = partText(out, name);
      expect(text.match(/<\?xml/g)).toHaveLength(1);
      expect(text.indexOf("<?xml")).toBe(0);
    }
  });

  it("removes the M365 per-comment timestamp part with the rest of the comments", () => {
    const comments = `${DECL}<w:comments ${W}><w:comment w:id="1" w:author="R"><w:p><w:r><w:t>note</w:t></w:r></w:p></w:comment></w:comments>`;
    const extensible =
      `${DECL}<w16cex:commentsExtensible xmlns:w16cex="http://schemas.microsoft.com/office/word/2018/wordml/cex">` +
      `<w16cex:commentExtensible w16cex:durableId="1B2C3D4E" w16cex:dateUtc="2024-01-01T00:00:00Z"/>` +
      `</w16cex:commentsExtensible>`;
    const source = buildDocx({
      comments,
      extra: { "word/commentsExtensible.xml": extensible },
    });
    const out = scrubDocx(source, SCRUB_ALL);
    expect(partNames(out)).not.toContain("word/commentsExtensible.xml");
    expect(categories(out)).not.toContain("comments");
  });
});
