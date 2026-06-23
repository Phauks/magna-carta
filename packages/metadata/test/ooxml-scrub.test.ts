import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { inspectDocx } from "../src/ooxml/inspect.ts";
import { scrubDocx } from "../src/ooxml/scrub.ts";
import { buildDocx } from "./support/docx-fixture.ts";

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const ALL_BUT_TRACKED = {
  identifyingMetadata: true,
  trackedChanges: false,
  comments: true,
  hiddenContent: true,
  customProperties: true,
  imageMetadata: true,
};

function bodyText(bytes: Uint8Array): string {
  return new TextDecoder().decode(unzipSync(bytes)["word/document.xml"]);
}

describe("scrubDocx (non-tracked-changes)", () => {
  it("removes identifying metadata", () => {
    const out = scrubDocx(buildDocx(), ALL_BUT_TRACKED);
    const after = inspectDocx(out).findings.map((f) => f.category);
    expect(after).not.toContain("identifying-metadata");
  });

  it("removes hidden text and preserves visible body text", () => {
    const document = `${DECL}<w:document ${W}><w:body><w:p><w:r><w:t>Keep me.</w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t>secret</w:t></w:r></w:p></w:body></w:document>`;
    const out = scrubDocx(buildDocx({ document }), ALL_BUT_TRACKED);
    expect(inspectDocx(out).findings.map((f) => f.category)).not.toContain("hidden-content");
    expect(bodyText(out)).toContain("Keep me.");
    expect(bodyText(out)).not.toContain("secret");
  });

  it("removes comments", () => {
    const comments = `${DECL}<w:comments ${W}><w:comment w:id="1" w:author="R"><w:p><w:r><w:t>n</w:t></w:r></w:p></w:comment></w:comments>`;
    const out = scrubDocx(buildDocx({ comments }), ALL_BUT_TRACKED);
    expect(inspectDocx(out).findings.map((f) => f.category)).not.toContain("comments");
  });
});
