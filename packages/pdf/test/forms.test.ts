import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureReady, fillForm, flattenForm, loadDocument, readForm } from "../src/index.js";

const w9 = new Uint8Array(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../../crates/pdf-eval/corpus-ci/gov_irs_w9_acroform.pdf",
        import.meta.url,
      ),
    ),
  ),
);

describe("forms", () => {
  beforeAll(async () => {
    await ensureReady(
      readFileSync(fileURLToPath(new URL("../src/pkg/pdf_core_bg.wasm", import.meta.url))),
    );
  });

  it("readForm returns a non-empty array with at least one text field", async () => {
    const fields = await readForm(w9);
    expect(fields.length).toBeGreaterThan(0);
    const textField = fields.find((f) => f.kind === "text");
    expect(textField).toBeDefined();
    expect(typeof textField!.name).toBe("string");
    expect(textField!.name.length).toBeGreaterThan(0);
  });

  it("fillForm + flattenForm round-trip: flattened PDF has no form fields", async () => {
    const fields = await readForm(w9);
    const target = fields.find((f) => f.kind === "text" && f.page !== null);
    expect(target).toBeDefined();
    const filled = await fillForm(w9, { [target!.name]: "ACMECORP" }, { flatten: true });
    expect(filled.pdf.byteLength).toBeGreaterThan(0);
    // Flattened PDF must still be a loadable document.
    const doc = await loadDocument(filled.pdf);
    expect(doc.pageCount).toBeGreaterThan(0);
    doc.free();
    // After flatten the AcroForm is dropped — readForm returns an empty array.
    const remaining = await readForm(filled.pdf);
    expect(remaining).toHaveLength(0);
  });

  it("fillForm without flatten returns a loadable PDF that still has fields", async () => {
    const fields = await readForm(w9);
    const target = fields.find((f) => f.kind === "text" && f.page !== null);
    expect(target).toBeDefined();
    const filled = await fillForm(w9, { [target!.name]: "ACMECORP" });
    expect(filled.pdf.byteLength).toBeGreaterThan(0);
    const doc = await loadDocument(filled.pdf);
    expect(doc.pageCount).toBeGreaterThan(0);
    doc.free();
    // Form must still be present — readForm still lists fields.
    const remaining = await readForm(filled.pdf);
    expect(remaining.length).toBeGreaterThan(0);
  });
});
