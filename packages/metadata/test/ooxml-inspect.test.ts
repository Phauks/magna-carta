import { describe, expect, it } from "vitest";
import { inspectDocx } from "../src/ooxml/inspect.ts";
import { buildDocx } from "./support/docx-fixture.ts";

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function categories(bytes: Uint8Array): Set<string> {
  return new Set(inspectDocx(bytes).findings.map((f) => f.category));
}

describe("inspectDocx", () => {
  it("finds identifying metadata in a default fixture", () => {
    expect(categories(buildDocx())).toContain("identifying-metadata");
  });

  it("finds tracked changes", () => {
    const document = `${DECL}<w:document ${W}><w:body><w:p><w:ins><w:r><w:t>added</w:t></w:r></w:ins></w:p></w:body></w:document>`;
    expect(categories(buildDocx({ document }))).toContain("tracked-changes");
  });

  it("finds hidden content", () => {
    const document = `${DECL}<w:document ${W}><w:body><w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>secret</w:t></w:r></w:p></w:body></w:document>`;
    expect(categories(buildDocx({ document }))).toContain("hidden-content");
  });

  it("finds comments when a comments part is present", () => {
    const comments = `${DECL}<w:comments ${W}><w:comment w:id="1" w:author="Reviewer"><w:p><w:r><w:t>note</w:t></w:r></w:p></w:comment></w:comments>`;
    expect(categories(buildDocx({ comments }))).toContain("comments");
  });

  it("reports a clean document with stripped properties", () => {
    const core = `${DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"/>`;
    const app = `${DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"/>`;
    const report = inspectDocx(buildDocx({ core, app }));
    expect(report.clean).toBe(true);
  });
});
