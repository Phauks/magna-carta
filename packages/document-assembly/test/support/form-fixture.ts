import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ensureReady,
  fillForm,
  readForm,
  sanitizeDocument,
  type FormFillValues,
} from "@magna-carta/pdf";
import type { DictionaryEntry } from "../../src/dictionary.ts";
import type { FormFiller, FormFillFinish } from "../../src/fill-form.ts";
import type { AcroFormReader, FormTemplateScrub } from "../../src/pdf-form.ts";
import type {
  AbsenceBehaviour,
  MergeContext,
  MergeValue,
  MergeValueType,
} from "../../src/types.ts";

// The real PDF engine, wired to this package's seams for the tests only.
//
// `@magna-carta/pdf` is a DEVELOPMENT dependency here and `src/` never imports it — `purity.test.ts`
// is the scan that keeps that true. The seams exist so the fill DECISION (which box gets which value,
// which absence shows a marker, which one fails the assembly) is testable without a PDF at all; these
// helpers exist so the other half — that the decision, handed to the real engine, produces a document
// with those values actually in it — is testable without a worker.

const wasmBytes = readFileSync(
  fileURLToPath(new URL("../../../pdf/src/pkg/pdf_core_bg.wasm", import.meta.url)),
);

export async function startEngine(): Promise<void> {
  await ensureReady(wasmBytes);
}

// The committed fixture: a two-page intake form for a firm that does not exist, built by
// `test/fixtures/build-fillable-form.mjs`. Nothing in it is a real client document or a real court's
// file.
export function intakeFormBytes(): Uint8Array {
  return new Uint8Array(
    readFileSync(fileURLToPath(new URL("../fixtures/intake-form.pdf", import.meta.url))),
  );
}

export const engineReader: AcroFormReader = async (bytes) => {
  try {
    return (await readForm(bytes)).map((field) => ({
      name: field.name,
      kind: field.kind,
      required: field.required,
      page: field.page,
      value: field.value,
      options: field.options,
      readOnly: field.readOnly,
    }));
  } catch {
    return undefined;
  }
};

export const engineScrub: FormTemplateScrub = async (bytes) => {
  try {
    return (await sanitizeDocument(bytes)).pdf;
  } catch {
    return undefined;
  }
};

export const engineFiller: FormFiller = async (bytes, values, finish: FormFillFinish) => {
  try {
    const filled = await fillForm(bytes, Object.fromEntries(values) as FormFillValues, {
      flatten: finish === "flattened",
    });
    return filled.pdf;
  } catch {
    return undefined;
  }
};

// What a filled document actually holds, read back through the engine. The assertions that matter are
// about the OUTPUT bytes rather than about the plan that produced them.
export async function filledValues(
  bytes: Uint8Array,
): Promise<Map<string, string | boolean | null>> {
  return new Map((await readForm(bytes)).map((field) => [field.name, field.value]));
}

export async function hasInteractiveForm(bytes: Uint8Array): Promise<boolean> {
  return (await readForm(bytes)).length > 0;
}

// A small explicit dictionary, rather than the shipped catalogue, so each test names exactly the absence
// behaviour and value type it is about.
export function entry(
  key: string,
  valueType: MergeValueType,
  absence: AbsenceBehaviour,
  defaultFormat = "plain",
): DictionaryEntry {
  return {
    key,
    source: "matter",
    valueType,
    defaultFormat,
    sensitivity: "ordinary",
    absence,
    description: `test entry for ${key}`,
    label: key,
    group: "matter",
    subject: "matter",
    prominence: "secondary",
    synonyms: [],
    exampleRenderings: {},
    status: "current",
  };
}

export function contextOf(values: Record<string, MergeValue>, timeZone = "UTC"): MergeContext {
  return {
    values: new Map(Object.entries(values)),
    absentKeys: [],
    absenceReasons: new Map(),
    timeZone,
  };
}

export const text = (value: string): MergeValue => ({ kind: "text", text: value });
export const yesNo = (value: boolean): MergeValue => ({ kind: "boolean", value });
