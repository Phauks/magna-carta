import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ensureReady,
  extractPdfText,
  inspectSecurity,
  readForm,
  secureDocument,
  stampBates,
} from "@magna-carta/pdf";
import {
  findBatesLabels,
  summarizeForm,
  withheldPermissions,
} from "../src/lib/pdf-editor/pdf-summary.ts";

const W9 = fileURLToPath(
  new URL("../../../crates/pdf-eval/corpus-ci/gov_irs_w9_acroform.pdf", import.meta.url),
);

describe("finding Bates labels", () => {
  it("finds one prefix numbered upward at the foot of every page", () => {
    const pages = [1, 2, 3].map((page) => ["Some heading", "Body text", `SMITH00000${page}`]);
    expect(findBatesLabels(pages)).toEqual({
      first: "SMITH000001",
      last: "SMITH000003",
      pagesLabelled: 3,
    });
  });

  it("reads a label that shares its line with other footer text, or is split by a space", () => {
    const pages = [["Form W-9 (Rev. 10-2018)   ABC-0041"], ["Page 2 of 2", "ABC-0042"]];
    expect(findBatesLabels(pages)?.first).toBe("ABC-0041");
    expect(findBatesLabels(pages)?.pagesLabelled).toBe(2);
  });

  it("reports nothing on pages that carry no label", () => {
    expect(findBatesLabels([["Request for Taxpayer", "OMB No. 1545-0074"], ["Page 2"]])).toBeNull();
    expect(findBatesLabels([])).toBeNull();
  });

  it("does not call a stray reference on one page of many a label run", () => {
    const pages = [["See EXHIBIT 2019"], ["Text"], ["Text"], ["Text"]];
    expect(findBatesLabels(pages)).toBeNull();
  });

  it("does not report numbers that run backwards", () => {
    expect(findBatesLabels([["DEF0009"], ["DEF0003"]])).toBeNull();
  });
});

describe("the form and its protection", () => {
  it("counts the fields that take an answer and how many hold one", () => {
    expect(
      summarizeForm([
        { kind: "text", value: "Jordan" },
        { kind: "text", value: "" },
        { kind: "checkbox", value: false },
        { kind: "checkbox", value: true },
        { kind: "pushButton", value: null },
        { kind: "signature", value: null },
      ]),
    ).toEqual({ fields: 4, filled: 2 });
    expect(summarizeForm([{ kind: "pushButton", value: null }])).toBeNull();
  });

  it("names the permissions an encrypted document withholds, and none for a plain one", () => {
    const all = {
      print: true,
      printHighRes: true,
      copy: true,
      modify: true,
      annotate: true,
      fillForms: true,
      assemble: true,
      accessibilityCopy: true,
    };
    expect(
      withheldPermissions({ encrypted: true, permissions: { ...all, print: false, copy: false } }),
    ).toEqual(["printing", "copying"]);
    expect(withheldPermissions({ encrypted: false, permissions: null })).toEqual([]);
  });
});

describe("against the engine", () => {
  beforeAll(async () => {
    await ensureReady(
      readFileSync(
        fileURLToPath(new URL("../../../packages/pdf/src/pkg/pdf_core_bg.wasm", import.meta.url)),
      ),
    );
  });

  it("reads the W-9's form and finds no labels on it until it is numbered", async () => {
    const bytes = new Uint8Array(readFileSync(W9));
    const form = summarizeForm(await readForm(bytes));
    expect(form?.fields).toBeGreaterThan(0);
    expect(form?.filled).toBe(0);

    const before = await extractPdfText(bytes);
    const linesOf = (text: typeof before): string[][] =>
      text.pages.map((page) => page.lines.map((line) => line.text));
    expect(findBatesLabels(linesOf(before))).toBeNull();

    const stamped = await stampBates(bytes, { prefix: "SMITH", startNumber: 41, padding: 6 });
    const found = findBatesLabels(linesOf(await extractPdfText(stamped.pdf)));
    expect(found).toEqual({
      first: "SMITH000041",
      last: `SMITH${String(40 + stamped.pageCount).padStart(6, "0")}`,
      pagesLabelled: stamped.pageCount,
    });
  });

  it("reads a copy protected with only a permissions password as encrypted, guessing no limits", async () => {
    const bytes = new Uint8Array(readFileSync(W9));
    const secured = await secureDocument(bytes, {
      ownerPassword: "owner-secret",
      permissions: { print: false },
    });
    const security = await inspectSecurity(secured.pdf);
    expect(security.hasUserPassword).toBe(false);
    expect(security.encrypted).toBe(true);
    // Without the permissions password the engine cannot read what is withheld, so it names nothing
    // rather than guess; the tab still says the file carries limits.
    expect(withheldPermissions(security)).toEqual([]);
  });
});
