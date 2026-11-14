import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ensureReady, fillForm, readForm, type FormField } from "@magna-carta/pdf";
import {
  answerOf,
  changedAnswers,
  fieldLabel,
  inPageOrder,
  unansweredRequired,
} from "../src/lib/pdf-editor/forms.ts";

function field(change: Partial<FormField>): FormField {
  return {
    name: "form.name",
    kind: "text",
    value: null,
    options: [],
    readOnly: false,
    required: false,
    page: 0,
    rect: null,
    ...change,
  };
}

describe("answers", () => {
  it("writes only what the reader changed, and never a read-only field", () => {
    const fields = [
      field({ name: "a", value: "same" }),
      field({ name: "b", value: "old" }),
      field({ name: "c", kind: "checkbox", value: false }),
      field({ name: "d", readOnly: true }),
      field({ name: "e", kind: "signature" }),
    ];
    const answers = { a: "same", b: "new", c: true, d: "sneaky", e: "x" };
    expect(changedAnswers(fields, answers)).toEqual({ b: "new", c: true });
  });

  it("shows the document's own value until the reader answers", () => {
    expect(answerOf(field({ value: "Jordan" }), {})).toBe("Jordan");
    expect(answerOf(field({ kind: "checkbox", value: true }), {})).toBe(true);
    expect(answerOf(field({ name: "x", value: "Jordan" }), { x: "" })).toBe("");
  });

  it("lists required fields still empty", () => {
    const fields = [
      field({ name: "r", required: true }),
      field({ name: "s", required: true, value: "done" }),
    ];
    expect(unansweredRequired(fields, {}).map((one) => one.name)).toEqual(["r"]);
    expect(unansweredRequired(fields, { r: "now" })).toEqual([]);
  });

  it("names a field the way a reader says it, and orders fields by page", () => {
    expect(fieldLabel("topmostSubform[0].Page1[0].f1_01[0]")).toBe("f1 01");
    expect(fieldLabel("Client_Name")).toBe("Client Name");
    const ordered = inPageOrder([
      field({ name: "two", page: 1 }),
      field({ name: "none", page: null }),
      field({ name: "one", page: 0 }),
    ]);
    expect(ordered.map((one) => one.name)).toEqual(["one", "two", "none"]);
  });
});

describe("filling a real form with the engine", () => {
  it("writes the changed answers and reads them back", async () => {
    await ensureReady(
      readFileSync(
        fileURLToPath(new URL("../../../packages/pdf/src/pkg/pdf_core_bg.wasm", import.meta.url)),
      ),
    );
    const form = new Uint8Array(
      readFileSync(
        fileURLToPath(
          new URL("../../../crates/pdf-eval/corpus-ci/gov_irs_w9_acroform.pdf", import.meta.url),
        ),
      ),
    );
    const fields = await readForm(form);
    const text = fields.find((one) => one.kind === "text" && !one.readOnly);
    expect(text).toBeDefined();
    const name = (text as FormField).name;
    const values = changedAnswers(fields, { [name]: "Harrow Logistics LLC" });
    const { pdf } = await fillForm(form, values);
    const after = await readForm(pdf);
    expect(after.find((one) => one.name === name)?.value).toBe("Harrow Logistics LLC");
  });
});
