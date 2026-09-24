import { describe, expect, it } from "vitest";
import {
  acceptTrackedChanges,
  MAX_REVISION_PART_CHARACTERS,
} from "../src/ooxml/accept-tracked-changes.ts";
import { readPackage, readPartText } from "../src/ooxml/package.ts";
import { buildDocx, documentXml, headerXml, paragraphOfRuns } from "./support/docx-fixture.ts";

const AUTHOR = 'w:id="1" w:author="Ana" w:date="2026-09-18T10:00:00Z"';

function run(text: string, properties = ""): string {
  return `<w:r>${properties}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}

function inserted(...runs: readonly string[]): string {
  return `<w:ins ${AUTHOR}>${runs.join("")}</w:ins>`;
}

function deleted(text: string): string {
  return `<w:del ${AUTHOR}><w:r><w:delText xml:space="preserve">${text}</w:delText></w:r></w:del>`;
}

function bodyOf(bytes: Uint8Array, part = "word/document.xml"): string {
  const read = readPackage(bytes);
  if (!read.ok) throw new Error(read.detail);
  return readPartText(read.value, part) ?? "";
}

// True when the part holds the element, written self-closed or as an open-close pair: the builder
// writes an empty element as a pair, which a reader takes the same way.
function hasElement(xml: string, tag: string, attributes = ""): boolean {
  const escaped = tag.replace(":", "\\:");
  const attributePart = attributes === "" ? "(?:\\s[^>]*)?" : `\\s${attributes}`;
  return new RegExp(`<${escaped}${attributePart}(?:/>|></${escaped}>)`).test(xml);
}

// The text a reader sees: every w:t and w:delText in document order, joined.
function visibleText(xml: string): string {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((match) => match[1]).join("");
}

describe("accepting every tracked change on the way out", () => {
  it("keeps an insertion's text and drops its wrapper", () => {
    const bytes = buildDocx({
      document: documentXml(
        `<w:p>${run("The court ")}${inserted(run("hereby "))}${run("orders.")}</w:p>`,
      ),
    });
    const accepted = acceptTrackedChanges(bytes);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    const body = bodyOf(accepted.value.bytes);
    expect(visibleText(body)).toBe("The court hereby orders.");
    expect(body).not.toContain("<w:ins");
    expect(accepted.value.acceptedMarks).toBe(1);
    expect(accepted.value.rewrittenParts).toEqual(["word/document.xml"]);
  });

  it("removes a deletion with its text", () => {
    const bytes = buildDocx({
      document: documentXml(`<w:p>${run("The court ")}${deleted("never ")}${run("orders.")}</w:p>`),
    });
    const accepted = acceptTrackedChanges(bytes);
    if (!accepted.ok) throw new Error(accepted.detail);
    const body = bodyOf(accepted.value.bytes);
    expect(visibleText(body)).toBe("The court orders.");
    expect(body).not.toContain("delText");
    expect(body).not.toContain("<w:del");
  });

  it("drops the record of a property change and keeps the current properties", () => {
    const bytes = buildDocx({
      document: documentXml(
        `<w:p><w:pPr><w:jc w:val="center"/><w:pPrChange ${AUTHOR}><w:pPr><w:jc w:val="left"/></w:pPr></w:pPrChange></w:pPr>` +
          run(
            "Heading",
            `<w:rPr><w:b/><w:rPrChange ${AUTHOR}><w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr>`,
          ) +
          "</w:p>",
      ),
    });
    const accepted = acceptTrackedChanges(bytes);
    if (!accepted.ok) throw new Error(accepted.detail);
    const body = bodyOf(accepted.value.bytes);
    expect(hasElement(body, "w:jc", 'w:val="center"')).toBe(true);
    expect(body).not.toContain('w:val="left"');
    expect(hasElement(body, "w:b")).toBe(true);
    expect(hasElement(body, "w:i")).toBe(false);
    expect(body).not.toContain("Change");
    expect(accepted.value.acceptedMarks).toBe(2);
  });

  it("joins a paragraph whose mark was deleted to the one after it, keeping the later mark", () => {
    const bytes = buildDocx({
      document: documentXml(
        `<w:p><w:pPr><w:jc w:val="left"/><w:rPr><w:del ${AUTHOR}/></w:rPr></w:pPr>${run("First half ")}</w:p>` +
          `<w:p><w:pPr><w:jc w:val="right"/></w:pPr>${run("second half.")}</w:p>` +
          `<w:p>${run("Untouched.")}</w:p>`,
      ),
    });
    const accepted = acceptTrackedChanges(bytes);
    if (!accepted.ok) throw new Error(accepted.detail);
    const body = bodyOf(accepted.value.bytes);
    const paragraphs = body.match(/<w:p>|<w:p /g) ?? [];
    expect(paragraphs).toHaveLength(2);
    expect(visibleText(body)).toBe("First half second half.Untouched.");
    // The joined paragraph carries the FOLLOWING paragraph's properties, as in Word.
    expect(hasElement(body, "w:jc", 'w:val="right"')).toBe(true);
    expect(hasElement(body, "w:jc", 'w:val="left"')).toBe(false);
    expect(body).not.toContain("<w:del");
  });

  it("folds a run of deleted paragraph marks into the one surviving paragraph, in order", () => {
    const bytes = buildDocx({
      document: documentXml(
        `<w:p><w:pPr><w:rPr><w:del ${AUTHOR}/></w:rPr></w:pPr>${run("one ")}</w:p>` +
          `<w:p><w:pPr><w:rPr><w:del ${AUTHOR}/></w:rPr></w:pPr>${run("two ")}</w:p>` +
          `<w:p>${run("three.")}</w:p>`,
      ),
    });
    const accepted = acceptTrackedChanges(bytes);
    if (!accepted.ok) throw new Error(accepted.detail);
    const body = bodyOf(accepted.value.bytes);
    expect(body.match(/<w:p>/g) ?? []).toHaveLength(1);
    expect(visibleText(body)).toBe("one two three.");
  });

  it("keeps the last paragraph's text when its deleted mark has nothing after it", () => {
    const bytes = buildDocx({
      document: documentXml(
        `<w:p>${run("Kept.")}</w:p>` +
          `<w:p><w:pPr><w:rPr><w:del ${AUTHOR}/></w:rPr></w:pPr>${run("Also kept.")}</w:p>`,
      ),
    });
    const accepted = acceptTrackedChanges(bytes);
    if (!accepted.ok) throw new Error(accepted.detail);
    const body = bodyOf(accepted.value.bytes);
    expect(visibleText(body)).toBe("Kept.Also kept.");
    expect(body.match(/<w:p>/g) ?? []).toHaveLength(2);
    expect(body).not.toContain("<w:del");
  });

  it("drops a deleted table row and a deleted cell, and keeps an inserted row", () => {
    const table =
      "<w:tbl>" +
      `<w:tr><w:trPr><w:ins ${AUTHOR}/></w:trPr><w:tc><w:p>${run("new row")}</w:p></w:tc></w:tr>` +
      `<w:tr><w:trPr><w:del ${AUTHOR}/></w:trPr><w:tc><w:p>${run("old row")}</w:p></w:tc></w:tr>` +
      `<w:tr><w:tc><w:tcPr><w:cellDel ${AUTHOR}/></w:tcPr><w:p>${run("old cell")}</w:p></w:tc>` +
      `<w:tc><w:p>${run("kept cell")}</w:p></w:tc></w:tr>` +
      "</w:tbl>";
    const bytes = buildDocx({ document: documentXml(table) });
    const accepted = acceptTrackedChanges(bytes);
    if (!accepted.ok) throw new Error(accepted.detail);
    const body = bodyOf(accepted.value.bytes);
    expect(visibleText(body)).toBe("new rowkept cell");
    expect(body.match(/<w:tr>/g) ?? []).toHaveLength(2);
    expect(body).not.toContain("<w:ins");
    expect(body).not.toContain("<w:del");
    expect(body).not.toContain("cellDel");
  });

  it("resolves a move: the source goes, the destination stays, the range markers go", () => {
    const bytes = buildDocx({
      document: documentXml(
        `<w:p><w:moveFromRangeStart w:id="7" w:name="move1" ${AUTHOR}/>` +
          `<w:moveFrom ${AUTHOR}><w:r><w:delText>moved text</w:delText></w:r></w:moveFrom>` +
          `<w:moveFromRangeEnd w:id="7"/>${run("stays. ")}</w:p>` +
          `<w:p><w:moveToRangeStart w:id="8" w:name="move1" ${AUTHOR}/>` +
          `<w:moveTo ${AUTHOR}>${run("moved text")}</w:moveTo><w:moveToRangeEnd w:id="8"/></w:p>`,
      ),
    });
    const accepted = acceptTrackedChanges(bytes);
    if (!accepted.ok) throw new Error(accepted.detail);
    const body = bodyOf(accepted.value.bytes);
    expect(visibleText(body)).toBe("stays. moved text");
    expect(body).not.toMatch(/move(From|To)/);
  });

  it("accepts inside headers and comments too, and lists each rewritten part", () => {
    const bytes = buildDocx({
      document: documentXml(paragraphOfRuns("Body without marks.")),
      header: headerXml(`<w:p>${inserted(run("Draft header"))}</w:p>`),
      extra: {
        "word/comments.xml":
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
          `<w:comment w:id="0"><w:p>${deleted("gone")}${run("kept")}</w:p></w:comment></w:comments>`,
      },
    });
    const accepted = acceptTrackedChanges(bytes);
    if (!accepted.ok) throw new Error(accepted.detail);
    expect(accepted.value.rewrittenParts).toEqual(["word/header1.xml", "word/comments.xml"]);
    expect(visibleText(bodyOf(accepted.value.bytes, "word/header1.xml"))).toBe("Draft header");
    expect(visibleText(bodyOf(accepted.value.bytes, "word/comments.xml"))).toBe("kept");
    // The body had nothing to accept and is the same bytes it was.
    const before = readPackage(bytes);
    const after = readPackage(accepted.value.bytes);
    if (!before.ok || !after.ok) throw new Error("fixture did not read back");
    expect(after.value.get("word/document.xml")).toEqual(before.value.get("word/document.xml"));
  });

  it("hands back the input bytes untouched when nothing is recorded", () => {
    const bytes = buildDocx({
      document: documentXml(paragraphOfRuns("Nothing ", "tracked ", "here.")),
    });
    const accepted = acceptTrackedChanges(bytes);
    if (!accepted.ok) throw new Error(accepted.detail);
    expect(accepted.value.bytes).toBe(bytes);
    expect(accepted.value.acceptedMarks).toBe(0);
    expect(accepted.value.rewrittenParts).toEqual([]);
  });

  it("preserves significant whitespace and entities through the rewrite", () => {
    const bytes = buildDocx({
      document: documentXml(
        `<w:p>${run("Smith &amp; Jones ")}${inserted(run("  v.  "))}${run("Brown &lt;Inc&gt;")}</w:p>`,
      ),
    });
    const accepted = acceptTrackedChanges(bytes);
    if (!accepted.ok) throw new Error(accepted.detail);
    const body = bodyOf(accepted.value.bytes);
    expect(body).toContain('<w:t xml:space="preserve">Smith &amp; Jones </w:t>');
    expect(body).toContain('<w:t xml:space="preserve">  v.  </w:t>');
    expect(body).toContain("Brown &lt;Inc&gt;");
  });

  it("refuses a revision part it cannot hold, naming the part", () => {
    const filler = run("x".repeat(1024)).repeat(Math.ceil(MAX_REVISION_PART_CHARACTERS / 1024) + 1);
    const bytes = buildDocx({
      document: documentXml(`<w:p>${inserted(run("a"))}${filler}</w:p>`),
      contentTypes: undefined,
    });
    const accepted = acceptTrackedChanges(bytes, {
      maxPackageBytes: 64 * 1024 * 1024,
      maxInflatedBytes: 64 * 1024 * 1024,
      maxEntryCount: 64,
    });
    expect(accepted.ok).toBe(false);
    if (accepted.ok) return;
    expect(accepted.reason).toBe("part-too-large");
    expect(accepted.detail).toContain("word/document.xml");
  });

  it("passes the package reader's refusals through", () => {
    const accepted = acceptTrackedChanges(new Uint8Array([1, 2, 3]));
    expect(accepted.ok).toBe(false);
    if (accepted.ok) return;
    expect(accepted.reason).toBe("not-a-package");
  });
});
