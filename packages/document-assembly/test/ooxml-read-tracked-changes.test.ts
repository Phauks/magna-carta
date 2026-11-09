import { describe, expect, it } from "vitest";
import { readTrackedChanges } from "../src/ooxml/read-tracked-changes.ts";
import { buildDocx, documentXml, headerXml, paragraphOfRuns } from "./support/docx-fixture.ts";

const ANA = 'w:author="Ana Vasquez" w:date="2026-09-24T10:00:00Z"';
const TREVOR = 'w:author="Trevor Goldsmith" w:date="2026-09-24T11:30:00Z"';

function run(text: string, properties = ""): string {
  return `<w:r>${properties}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}
function inserted(by: string, ...runs: readonly string[]): string {
  return `<w:ins w:id="1" ${by}>${runs.join("")}</w:ins>`;
}
function deleted(by: string, text: string): string {
  return `<w:del w:id="2" ${by}><w:r><w:delText xml:space="preserve">${text}</w:delText></w:r></w:del>`;
}

function readAll(bytes: Uint8Array) {
  const outcome = readTrackedChanges(bytes);
  if (!outcome.ok) throw new Error(outcome.detail);
  return outcome.value.changes;
}

describe("reading a document's tracked changes", () => {
  it("reads an insertion and a deletion with their author, instant, words and place", () => {
    const changes = readAll(
      buildDocx({
        document: documentXml(
          `<w:p>${run("Untouched.")}</w:p>`,
          `<w:p>${run("The court ")}${inserted(ANA, run("hereby "))}${deleted(TREVOR, "never ")}${run("orders.")}</w:p>`,
        ),
      }),
    );
    expect(changes).toEqual([
      {
        kind: "insertion",
        author: "Ana Vasquez",
        changedAt: "2026-09-24T10:00:00Z",
        text: "hereby ",
        part: "word/document.xml",
        paragraphIndex: 1,
      },
      {
        kind: "deletion",
        author: "Trevor Goldsmith",
        changedAt: "2026-09-24T11:30:00Z",
        text: "never ",
        part: "word/document.xml",
        paragraphIndex: 1,
      },
    ]);
  });

  it("folds one act of typing split across runs into one mark, and keeps different authors apart", () => {
    const changes = readAll(
      buildDocx({
        document: documentXml(
          `<w:p>${inserted(ANA, run("here"))}${inserted(ANA, run("by "))}${inserted(TREVOR, run("so "))}${inserted(ANA, run("ordered"))}</w:p>`,
        ),
      }),
    );
    expect(changes.map((change) => [change.author, change.text])).toEqual([
      ["Ana Vasquez", "hereby "],
      ["Trevor Goldsmith", "so "],
      ["Ana Vasquez", "ordered"],
    ]);
  });

  it("reads a deleted paragraph mark as a deleted break, and a deleted row with its words", () => {
    const changes = readAll(
      buildDocx({
        document: documentXml(
          `<w:p><w:pPr><w:rPr><w:del w:id="3" ${ANA}/></w:rPr></w:pPr>${run("First")}</w:p>` +
            `<w:p>${run("Second")}</w:p>` +
            `<w:tbl><w:tr><w:trPr><w:del w:id="4" ${TREVOR}/></w:trPr><w:tc><w:p>${run("old ")}</w:p></w:tc><w:tc><w:p>${run("row")}</w:p></w:tc></w:tr></w:tbl>`,
        ),
      }),
    );
    expect(changes.map((change) => [change.kind, change.author, change.text])).toEqual([
      ["deletion", "Ana Vasquez", "\n"],
      ["deletion", "Trevor Goldsmith", "old row"],
    ]);
  });

  it("reads a formatting change on a run with the run's words, and one on a paragraph without", () => {
    const changes = readAll(
      buildDocx({
        document: documentXml(
          `<w:p><w:pPr><w:jc w:val="center"/><w:pPrChange w:id="5" ${TREVOR}><w:pPr/></w:pPrChange></w:pPr>` +
            run(
              "Heading",
              `<w:rPr><w:b/><w:rPrChange w:id="6" ${ANA}><w:rPr/></w:rPrChange></w:rPr>`,
            ) +
            "</w:p>",
        ),
      }),
    );
    expect(changes.map((change) => [change.kind, change.author, change.text])).toEqual([
      ["formatting", "Trevor Goldsmith", ""],
      ["formatting", "Ana Vasquez", "Heading"],
    ]);
  });

  it("reads a move as a deletion at its source and an insertion at its destination", () => {
    const changes = readAll(
      buildDocx({
        document: documentXml(
          `<w:p><w:moveFromRangeStart w:id="7" w:name="m" ${ANA}/><w:moveFrom w:id="8" ${ANA}><w:r><w:delText>moved</w:delText></w:r></w:moveFrom><w:moveFromRangeEnd w:id="7"/></w:p>` +
            `<w:p><w:moveToRangeStart w:id="9" w:name="m" ${ANA}/><w:moveTo w:id="10" ${ANA}>${run("moved")}</w:moveTo><w:moveToRangeEnd w:id="9"/></w:p>`,
        ),
      }),
    );
    expect(changes.map((change) => [change.kind, change.text, change.paragraphIndex])).toEqual([
      ["deletion", "moved", 0],
      ["insertion", "moved", 1],
    ]);
  });

  it("reads every revision part, naming each", () => {
    const changes = readAll(
      buildDocx({
        document: documentXml(paragraphOfRuns("Nothing here.")),
        header: headerXml(`<w:p>${inserted(ANA, run("Draft"))}</w:p>`),
      }),
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]?.part).toBe("word/header1.xml");
  });

  it("reads a document with nothing recorded as no changes", () => {
    expect(readAll(buildDocx())).toEqual([]);
  });

  it("carries a missing date as null and a missing author as an empty name", () => {
    const changes = readAll(
      buildDocx({ document: documentXml(`<w:p><w:ins w:id="1">${run("x")}</w:ins></w:p>`) }),
    );
    expect(changes[0]?.author).toBe("");
    expect(changes[0]?.changedAt).toBeNull();
  });
});
