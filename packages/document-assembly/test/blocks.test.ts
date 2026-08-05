import { describe, expect, it } from "vitest";
import { assemble } from "../src/assemble.ts";
import { normalizeTemplate } from "../src/normalize.ts";
import { readPackage, readPartText, writePackage } from "../src/ooxml/package.ts";
import type { MergeContext, MergeValue } from "../src/types.ts";
import { buildDocx, documentXml, paragraphOfRuns, WORD_NAMESPACE } from "./support/docx-fixture.ts";

// Conditionals, repeats, and computed fields as they meet an actual OOXML package. The two hardest
// problems in this slice are a grammar's totality and a table row's banding, and they are deliberately
// tested apart: everything about the language is proven in the expression suites, and everything here
// is about what happens to paragraphs and rows.

function partsOf(document: string) {
  const read = readPackage(buildDocx({ document }));
  if (!read.ok) throw new Error(read.detail);
  return read.value;
}

// Register a template and hand back the bytes a registration would store, so an assembly runs over
// exactly what the pipeline produces rather than over hand-written XML.
function registered(document: string): Uint8Array {
  const result = normalizeTemplate(partsOf(document));
  if (result.failures.length > 0) {
    throw new Error(result.failures.map((failure) => failure.detail).join("; "));
  }
  return writePackage(result.parts);
}

function contextOf(
  values: Record<string, MergeValue>,
  absentKeys: readonly string[] = [],
): MergeContext {
  return {
    values: new Map(Object.entries(values)),
    absentKeys,
    absenceReasons: new Map(),
    timeZone: "UTC",
  };
}

const BASE_VALUES: Record<string, MergeValue> = {
  "matter.number": { kind: "text", text: "2026-0042" },
  "matter.title": { kind: "text", text: "Acme v. Riverside" },
  "matter.status": { kind: "text", text: "open" },
  "matter.eBilling": { kind: "boolean", value: true },
  "firm.name": { kind: "text", text: "Riverside Law LLP" },
  "system.today": { kind: "instant", isoInstant: "2026-08-04T10:00:00.000Z" },
};

function assembledText(bytes: Uint8Array, context: MergeContext): string {
  const outcome = assemble(bytes, context);
  if (!outcome.ok) throw new Error(`${outcome.reason}: ${outcome.detail}`);
  const read = readPackage(outcome.bytes);
  if (!read.ok) throw new Error(read.detail);
  return readPartText(read.value, "word/document.xml") ?? "";
}

// A numbered-list paragraph: numbering is a paragraph property, so a list survives a removed middle
// item only if whole paragraphs are removed and every survivor keeps its own numPr.
function numberedParagraph(text: string): string {
  return `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function tableRow(...cells: readonly string[]): string {
  const body = cells
    .map(
      (cell) =>
        `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr><w:p><w:r><w:t xml:space="preserve">${cell}</w:t></w:r></w:p></w:tc>`,
    )
    .join("");
  return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${body}</w:tr>`;
}

// A banded table: the banding is declared once on the table, in tblPr/tblLook, and Word bands from a
// row's POSITION — so removing or repeating whole rows is what keeps banding correct.
function bandedTable(...rows: readonly string[]): string {
  return `<w:tbl><w:tblPr><w:tblStyle w:val="GridTable4"/><w:tblLook w:val="04A0" w:firstRow="1" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>${rows.join("")}</w:tbl>`;
}

function documentWith(...blocks: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${WORD_NAMESPACE}><w:body>${blocks.join("")}</w:body></w:document>`;
}

describe("conditional blocks", () => {
  it("keeps the body when the condition holds and drops the marker paragraphs with it", () => {
    const bytes = registered(
      documentXml(
        paragraphOfRuns("Before."),
        paragraphOfRuns("{{#if matter.eBilling}}"),
        paragraphOfRuns("This matter bills electronically."),
        paragraphOfRuns("{{/if}}"),
        paragraphOfRuns("After."),
      ),
    );
    const text = assembledText(bytes, contextOf(BASE_VALUES));
    expect(text).toContain("This matter bills electronically.");
    expect(text).not.toContain("{{#if");
    expect(text).not.toContain("{{/if");
  });

  it("drops the whole body when the condition does not hold", () => {
    const bytes = registered(
      documentXml(
        paragraphOfRuns("Before."),
        paragraphOfRuns("{{#if matter.eBilling}}"),
        paragraphOfRuns("This matter bills electronically."),
        paragraphOfRuns("{{/if}}"),
        paragraphOfRuns("After."),
      ),
    );
    const text = assembledText(
      bytes,
      contextOf({ ...BASE_VALUES, "matter.eBilling": { kind: "boolean", value: false } }),
    );
    expect(text).not.toContain("bills electronically");
    expect(text).toContain("Before.");
    expect(text).toContain("After.");
  });

  it("reads {{#unless}} as the negation, which is only a reading difference", () => {
    const bytes = registered(
      documentXml(
        paragraphOfRuns("{{#unless matter.eBilling}}"),
        paragraphOfRuns("Please send a paper invoice."),
        paragraphOfRuns("{{/unless}}"),
      ),
    );
    expect(assembledText(bytes, contextOf(BASE_VALUES))).not.toContain("paper invoice");
    expect(
      assembledText(
        bytes,
        contextOf({ ...BASE_VALUES, "matter.eBilling": { kind: "boolean", value: false } }),
      ),
    ).toContain("paper invoice");
  });

  it("reads a bare NON-BOOLEAN key as a presence test", () => {
    const bytes = registered(
      documentXml(
        paragraphOfRuns("{{#if client.code}}"),
        paragraphOfRuns("Our reference: {{client.code}}"),
        paragraphOfRuns("{{/if}}"),
      ),
    );
    expect(assembledText(bytes, contextOf(BASE_VALUES))).not.toContain("Our reference");
    expect(
      assembledText(
        bytes,
        contextOf({ ...BASE_VALUES, "client.code": { kind: "text", text: "ACME-001" } }),
      ),
    ).toContain("ACME-001");
  });

  it("FAILS THE ASSEMBLY on an unresolved condition, naming the key and the total form to write instead", () => {
    // A wrong branch is invisible: nobody reads a contract and notices the paragraph that is not there.
    const bytes = registered(
      documentXml(
        paragraphOfRuns('{{#if matter.status == "closed"}}'),
        paragraphOfRuns("This matter is closed."),
        paragraphOfRuns("{{/if}}"),
      ),
    );
    const { "matter.status": _absent, ...withoutStatus } = BASE_VALUES;
    const outcome = assemble(bytes, contextOf(withoutStatus));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("expression-unresolved");
    expect(outcome.keys).toEqual(["matter.status"]);
    expect(outcome.detail).toContain("has(matter.status)");
  });

  it("never fails on an unresolved value the author wrapped in has(), which is total", () => {
    const bytes = registered(
      documentXml(
        paragraphOfRuns("{{#if has(client.code)}}"),
        paragraphOfRuns("Our reference is on file."),
        paragraphOfRuns("{{/if}}"),
      ),
    );
    expect(assembledText(bytes, contextOf(BASE_VALUES))).not.toContain("on file");
  });

  it("renumbers a numbered list correctly when a middle item is removed", () => {
    const bytes = registered(
      documentWith(
        numberedParagraph("First."),
        paragraphOfRuns("{{#if matter.eBilling}}"),
        numberedParagraph("Second, only when billed electronically."),
        paragraphOfRuns("{{/if}}"),
        numberedParagraph("Third."),
      ),
    );
    const text = assembledText(
      bytes,
      contextOf({ ...BASE_VALUES, "matter.eBilling": { kind: "boolean", value: false } }),
    );
    // Word derives the numbers from the surviving paragraphs' own numPr, so continuity is a property of
    // removing WHOLE paragraphs and leaving every survivor's numbering properties untouched.
    expect(text).toContain("First.");
    expect(text).toContain("Third.");
    expect(text).not.toContain("only when billed");
    expect([...text.matchAll(/<w:numId w:val="7"/g)]).toHaveLength(2);
    expect(text).toContain('w:ilvl w:val="0"');
  });

  it("removes a WHOLE ROW when the marker sits in the row's first cell, keeping the table's banding", () => {
    const bytes = registered(
      documentWith(
        bandedTable(
          tableRow("Item", "Amount"),
          tableRow("{{#if matter.eBilling}}", ""),
          tableRow("Electronic billing surcharge", "0.00"),
          tableRow("{{/if}}", ""),
          tableRow("Total", "0.00"),
        ),
      ),
    );
    const text = assembledText(
      bytes,
      contextOf({ ...BASE_VALUES, "matter.eBilling": { kind: "boolean", value: false } }),
    );
    // Banding is a table-level declaration and Word bands from a row's position, so the assertion is
    // that the declaration survives and that only whole rows went.
    expect(text).toContain('w:tblLook w:val="04A0"');
    expect(text).toContain('w:tblStyle w:val="GridTable4"');
    expect(text).not.toContain("surcharge");
    expect([...text.matchAll(/<w:tr>/g)]).toHaveLength(2);
    expect([...text.matchAll(/<w:cantSplit/g)]).toHaveLength(2);
  });

  it("handles a marker Word split across five runs, which is the shape it actually writes", () => {
    const bytes = registered(
      documentXml(
        paragraphOfRuns("{", "{", "#if matter", ".eBilling", "}}"),
        paragraphOfRuns("Split marker body."),
        paragraphOfRuns("{{", "/if", "}}"),
      ),
    );
    expect(assembledText(bytes, contextOf(BASE_VALUES))).toContain("Split marker body.");
  });

  it("refuses at registration a block that opens in a cell and closes outside the table", () => {
    const result = normalizeTemplate(
      partsOf(
        documentWith(
          bandedTable(tableRow("{{#if matter.eBilling}}", "")),
          paragraphOfRuns("{{/if}}"),
        ),
      ),
    );
    expect(result.failures.map((failure) => failure.code)).toContain("block-unbalanced");
  });

  it("refuses at registration a block nested deeper than the cap", () => {
    const open = Array.from({ length: 6 }, () => paragraphOfRuns("{{#if matter.eBilling}}"));
    const close = Array.from({ length: 6 }, () => paragraphOfRuns("{{/if}}"));
    const result = normalizeTemplate(
      partsOf(documentXml(...open, paragraphOfRuns("Deep."), ...close)),
    );
    expect(result.failures.map((failure) => failure.code)).toContain("block-nesting-too-deep");
  });
});

describe("repeating blocks", () => {
  const PARTIES: MergeValue = {
    kind: "list",
    items: [
      {
        fields: new Map<string, MergeValue>([
          ["displayName", { kind: "text", text: "Acme Holdings LLC" }],
          ["role", { kind: "text", text: "client" }],
          ["kind", { kind: "text", text: "organisation" }],
        ]),
      },
      {
        fields: new Map<string, MergeValue>([
          ["displayName", { kind: "text", text: "Riverside Partners" }],
          ["role", { kind: "text", text: "opposing_party" }],
          ["kind", { kind: "text", text: "organisation" }],
        ]),
      },
    ],
  };

  it("clones the body once per item and rebinds the scope each time", () => {
    const bytes = registered(
      documentXml(
        paragraphOfRuns("{{#each matter.parties}}"),
        paragraphOfRuns("{{loop.index}}. {{matter.parties.displayName}} ({{matter.parties.role}})"),
        paragraphOfRuns("{{/each}}"),
      ),
    );
    const text = assembledText(bytes, contextOf({ ...BASE_VALUES, "matter.parties": PARTIES }));
    expect(text).toContain("1. Acme Holdings LLC (client)");
    expect(text).toContain("2. Riverside Partners (opposing_party)");
  });

  it("carries loop.first, loop.last, and loop.count", () => {
    const bytes = registered(
      documentXml(
        paragraphOfRuns("{{#each matter.parties}}"),
        paragraphOfRuns('{{= choose(loop.first, "first", "later")}} of {{loop.count}}'),
        paragraphOfRuns("{{/each}}"),
      ),
    );
    const text = assembledText(bytes, contextOf({ ...BASE_VALUES, "matter.parties": PARTIES }));
    expect(text).toContain("first of 2");
    expect(text).toContain("later of 2");
  });

  it("produces nothing at all for an empty collection", () => {
    const bytes = registered(
      documentXml(
        paragraphOfRuns("Parties:"),
        paragraphOfRuns("{{#each matter.parties}}"),
        paragraphOfRuns("- {{matter.parties.displayName}}"),
        paragraphOfRuns("{{/each}}"),
      ),
    );
    const text = assembledText(
      bytes,
      contextOf({ ...BASE_VALUES, "matter.parties": { kind: "list", items: [] } }),
    );
    expect(text).toContain("Parties:");
    expect(text).not.toContain("- ");
  });

  it("repeats a WHOLE ROW, and every clone carries its own row properties", () => {
    const bytes = registered(
      documentWith(
        bandedTable(
          tableRow("Party", "Role"),
          tableRow("{{#each matter.parties}}", ""),
          tableRow("{{matter.parties.displayName}}", "{{matter.parties.role}}"),
          tableRow("{{/each}}", ""),
        ),
      ),
    );
    const text = assembledText(bytes, contextOf({ ...BASE_VALUES, "matter.parties": PARTIES }));
    expect(text).toContain("Acme Holdings LLC");
    expect(text).toContain("Riverside Partners");
    // Header plus one row per party, each with its own trPr — banding is computed from position, so a
    // clone that shared a row node with its sibling would band wrongly and print once.
    expect([...text.matchAll(/<w:tr>/g)]).toHaveLength(3);
    expect([...text.matchAll(/<w:cantSplit/g)]).toHaveLength(3);
    expect(text).toContain('w:tblLook w:val="04A0"');
  });

  it("keeps a repeated numbered item numbered, one numPr per clone", () => {
    const bytes = registered(
      documentWith(
        paragraphOfRuns("{{#each matter.parties}}"),
        numberedParagraph("{{matter.parties.displayName}}"),
        paragraphOfRuns("{{/each}}"),
      ),
    );
    const text = assembledText(bytes, contextOf({ ...BASE_VALUES, "matter.parties": PARTIES }));
    expect([...text.matchAll(/<w:numId w:val="7"/g)]).toHaveLength(2);
  });

  it("nests an each inside an if", () => {
    const bytes = registered(
      documentXml(
        paragraphOfRuns("{{#if matter.eBilling}}"),
        paragraphOfRuns("{{#each matter.parties}}"),
        paragraphOfRuns("- {{matter.parties.displayName}}"),
        paragraphOfRuns("{{/each}}"),
        paragraphOfRuns("{{/if}}"),
      ),
    );
    expect(
      assembledText(bytes, contextOf({ ...BASE_VALUES, "matter.parties": PARTIES })),
    ).toContain("- Acme Holdings LLC");
    expect(
      assembledText(
        bytes,
        contextOf({
          ...BASE_VALUES,
          "matter.parties": PARTIES,
          "matter.eBilling": { kind: "boolean", value: false },
        }),
      ),
    ).not.toContain("Acme Holdings");
  });

  it("FAILS LOUDLY when a repeat exceeds the item cap", () => {
    const bytes = registered(
      documentXml(
        paragraphOfRuns("{{#each matter.parties}}"),
        paragraphOfRuns("- {{matter.parties.displayName}}"),
        paragraphOfRuns("{{/each}}"),
      ),
    );
    const many: MergeValue = {
      kind: "list",
      items: Array.from({ length: 1_001 }, () => ({
        fields: new Map<string, MergeValue>([["displayName", { kind: "text", text: "x" }]]),
      })),
    };
    const outcome = assemble(bytes, contextOf({ ...BASE_VALUES, "matter.parties": many }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("expression-refused");
    expect(outcome.detail).toContain("1000");
  });

  it("walks the parts of an allocate, which are the only list a calculation may produce", () => {
    const result = normalizeTemplate(
      partsOf(
        documentXml(
          paragraphOfRuns("{{#each allocate(custom.settlement, 3)}}"),
          paragraphOfRuns("Part {{loop.index}}: {{loop.value}}"),
          paragraphOfRuns("{{/each}}"),
        ),
      ),
    );
    // The dictionary carries no money key yet — money sources arrive with the custom-field bindings —
    // so this asserts the RULE rather than the rendering: the collection has to be a name or an
    // allocate, and the failure names the field rather than the syntax.
    expect(result.failures.map((failure) => failure.code)).toEqual(["expression-unknown-key"]);
  });

  it("refuses at registration a repeat over anything but a collection or an allocate", () => {
    const result = normalizeTemplate(
      partsOf(
        documentXml(
          paragraphOfRuns("{{#each matter.number}}"),
          paragraphOfRuns("x"),
          paragraphOfRuns("{{/each}}"),
        ),
      ),
    );
    expect(result.failures.map((failure) => failure.code)).toContain("expression-type-error");
  });
});

describe("computed fields", () => {
  it("renders a calculation and records it on the manifest with the keys it reads", () => {
    const result = normalizeTemplate(
      partsOf(documentXml(paragraphOfRuns("Filed {{= addDays(system.today, 30):short}}."))),
    );
    expect(result.failures).toEqual([]);
    expect(result.manifest.computedFields).toEqual([
      {
        source: "addDays(system.today, 30)",
        format: "short",
        resultType: "date",
        part: "word/document.xml",
        keys: ["system.today"],
        occurrences: 1,
      },
    ]);
    const text = assembledText(writePackage(result.parts), contextOf(BASE_VALUES));
    expect(text).toContain("Filed 9/3/2026.");
  });

  it("leaves a plain placeholder meaning exactly what it always meant", () => {
    const bytes = registered(documentXml(paragraphOfRuns("Matter {{matter.number}}.")));
    expect(assembledText(bytes, contextOf(BASE_VALUES))).toContain("Matter 2026-0042.");
  });

  it("renders a VISIBLE PLACEHOLDER for an unresolved calculation rather than failing the assembly", () => {
    // The asymmetry with a condition is the whole point: a hole on the page is something a human
    // reading the draft cannot miss, and a missing clause is not.
    const bytes = registered(documentXml(paragraphOfRuns('{{= default(client.code, "none")}}')));
    expect(assembledText(bytes, contextOf(BASE_VALUES))).toContain("none");

    const bare = registered(documentXml(paragraphOfRuns("{{= upper(client.code)}}")));
    const outcome = assemble(bare, contextOf(BASE_VALUES));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.absences.map((absence) => absence.key)).toEqual(["client.code"]);
  });

  it("splits the format suffix at the last colon OUTSIDE quoted text", () => {
    const result = normalizeTemplate(
      partsOf(
        documentXml(paragraphOfRuns('{{= concat(matter.number, ": ", matter.title):upper}}')),
      ),
    );
    expect(result.failures).toEqual([]);
    expect(result.manifest.computedFields[0]).toMatchObject({
      source: 'concat(matter.number, ": ", matter.title)',
      format: "upper",
    });
    const text = assembledText(writePackage(result.parts), contextOf(BASE_VALUES));
    expect(text).toContain("2026-0042: ACME V. RIVERSIDE");
  });

  it("refuses a rendering the result type does not support, at registration", () => {
    const result = normalizeTemplate(
      partsOf(documentXml(paragraphOfRuns("{{= upper(matter.title):currency}}"))),
    );
    expect(result.failures[0]).toMatchObject({ code: "expression-format-illegal" });
  });

  it("carries the character offset into the expression so the inspector can point inside it", () => {
    const result = normalizeTemplate(
      partsOf(documentXml(paragraphOfRuns("{{= upper(matter.titel)}}"))),
    );
    expect(result.failures[0]?.code).toBe("expression-unknown-key");
    expect(result.failures[0]?.detail).toContain("at character");
  });
});

describe("dictionary drift", () => {
  it("fails an assembly whose stored expression no longer checks, naming the key", () => {
    const bytes = registered(
      documentXml(paragraphOfRuns("{{= upper(matter.title)}}"), paragraphOfRuns("body")),
    );
    // Re-checking at assembly time against the dictionary the firm has TODAY is the only thing that
    // catches a template bound in March to a field archived in June.
    const outcome = assemble(bytes, contextOf(BASE_VALUES), {
      dictionary: [
        {
          key: "matter.number",
          source: "matter",
          valueType: "text",
          defaultFormat: "plain",
          sensitivity: "ordinary",
          absence: "fail",
          description: "The matter's file number.",
        },
      ],
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("expression-invalid");
    expect(outcome.detail).toContain("matter.title");
  });
});
