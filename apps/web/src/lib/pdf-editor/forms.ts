/*
 * Filling in a PDF form: the fields the engine reads out of the document, the answers the reader
 * types, and what is handed back to the engine to write.
 *
 * Only what the reader changed is written, so a field nobody touched keeps exactly the value and
 * appearance it had. Read-only fields, push buttons and signature fields are shown but never
 * written: the first because the form says so, the others because they hold no answer to type.
 */
import type { FormField, FormFillValues } from "@magna-carta/pdf";

/** The kinds of field a reader can answer here. */
export const ANSWERABLE_KINDS: ReadonlySet<FormField["kind"]> = new Set([
  "text",
  "checkbox",
  "radio",
  "choice",
]);

/** Whether a reader can type or pick an answer in this field. */
export function isAnswerable(field: Pick<FormField, "kind" | "readOnly">): boolean {
  return ANSWERABLE_KINDS.has(field.kind) && !field.readOnly;
}

/** The answers the reader has given, keyed by the field's full name. */
export type FormAnswers = Readonly<Record<string, string | boolean>>;

/** A field's answer as the screen shows it: the reader's if they gave one, else the document's. */
export function answerOf(field: FormField, answers: FormAnswers): string | boolean {
  const given = answers[field.name];
  if (given !== undefined) return given;
  if (field.kind === "checkbox") return field.value === true;
  return typeof field.value === "string" ? field.value : "";
}

/** The answers that differ from what the document already holds, ready for the engine. */
export function changedAnswers(fields: readonly FormField[], answers: FormAnswers): FormFillValues {
  const changed: Record<string, string | boolean> = {};
  for (const field of fields) {
    if (!isAnswerable(field)) continue;
    const given = answers[field.name];
    if (given === undefined) continue;
    const before = field.kind === "checkbox" ? field.value === true : (field.value ?? "");
    if (given !== before) changed[field.name] = given;
  }
  return changed;
}

/** The fields the form marks as required that have no answer yet. */
export function unansweredRequired(
  fields: readonly FormField[],
  answers: FormAnswers,
): FormField[] {
  return fields.filter((field) => {
    if (!field.required || !isAnswerable(field)) return false;
    const answer = answerOf(field, answers);
    return answer === "" || answer === false;
  });
}

/**
 * A field's name as a reader would say it. Form tools write names like
 * "topmostSubform[0].Page1[0].f1_01[0]"; the last part, without its index, is the field's own name.
 */
export function fieldLabel(name: string): string {
  const last = name.split(".").at(-1) ?? name;
  const plain = last
    .replace(/\[\d+\]$/, "")
    .replace(/_/g, " ")
    .trim();
  return plain === "" ? name : plain;
}

/** The fields in the order a reader meets them: by page, then as the document lists them. */
export function inPageOrder(fields: readonly FormField[]): FormField[] {
  return fields
    .map((field, index) => ({ field, index }))
    .toSorted(
      (first, second) =>
        (first.field.page ?? Number.MAX_SAFE_INTEGER) -
          (second.field.page ?? Number.MAX_SAFE_INTEGER) || first.index - second.index,
    )
    .map((entry) => entry.field);
}
