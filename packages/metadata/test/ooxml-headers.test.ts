import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { inspectDocx } from "../src/ooxml/inspect.ts";
import { scrubDocx } from "../src/ooxml/scrub.ts";
import { buildDocx } from "./support/docx-fixture.ts";

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

const ALL_OPTIONS = {
  identifyingMetadata: true,
  trackedChanges: true,
  comments: true,
  hiddenContent: true,
  customProperties: true,
  imageMetadata: true,
};

function headerText(bytes: Uint8Array): string {
  const entries = unzipSync(bytes);
  const raw = entries["word/header1.xml"];
  return raw !== undefined ? new TextDecoder().decode(raw) : "";
}

function categories(bytes: Uint8Array): Set<string> {
  return new Set(inspectDocx(bytes).findings.map((f) => f.category));
}

describe("inspect + scrub: headers, footers, footnotes, endnotes", () => {
  it("inspect finds tracked-changes (w:ins) in a header part", () => {
    const header = `${DECL}<w:hdr ${W}><w:p><w:ins w:id="1" w:author="A" w:date="2024-01-01T00:00:00Z"><w:r><w:t>inserted header text</w:t></w:r></w:ins></w:p></w:hdr>`;
    expect(categories(buildDocx({ header }))).toContain("tracked-changes");
  });

  it("inspect finds tracked-changes (w:del) in a header part", () => {
    const header = `${DECL}<w:hdr ${W}><w:p><w:del w:id="2" w:author="A" w:date="2024-01-01T00:00:00Z"><w:r><w:delText>deleted header text</w:delText></w:r></w:del></w:p></w:hdr>`;
    expect(categories(buildDocx({ header }))).toContain("tracked-changes");
  });

  it("inspect finds hidden-content (w:vanish) in a header part", () => {
    const header = `${DECL}<w:hdr ${W}><w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>secret header</w:t></w:r></w:p></w:hdr>`;
    expect(categories(buildDocx({ header }))).toContain("hidden-content");
  });

  it("scrub removes tracked-changes (w:ins) from a header and re-inspect is clean", () => {
    const header = `${DECL}<w:hdr ${W}><w:p><w:ins w:id="1" w:author="A" w:date="2024-01-01T00:00:00Z"><w:r><w:t>inserted header text</w:t></w:r></w:ins></w:p></w:hdr>`;
    // Strip identifying metadata too so the only potential finding is from the header content.
    const scrubbed = scrubDocx(buildDocx({ header }), ALL_OPTIONS);
    expect(categories(scrubbed)).not.toContain("tracked-changes");
  });

  it("scrub removes hidden runs (w:vanish) from a header, preserves visible text, and re-inspect is clean", () => {
    const header = `${DECL}<w:hdr ${W}><w:p><w:r><w:t>Visible header.</w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t>hidden header</w:t></w:r></w:p></w:hdr>`;
    const scrubbed = scrubDocx(buildDocx({ header }), ALL_OPTIONS);
    expect(categories(scrubbed)).not.toContain("hidden-content");
    expect(headerText(scrubbed)).toContain("Visible header.");
    expect(headerText(scrubbed)).not.toContain("hidden header");
  });
});
