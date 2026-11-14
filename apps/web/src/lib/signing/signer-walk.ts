/*
 * The walk through a signer's own fields, kept out of the component so it is tested without a page.
 *
 * WHAT COUNTS AS DONE. A signature or initials field is done once the signer has adopted a mark,
 * because adopting is the act that puts it there. A text field is done when it holds words, a
 * checkbox when it is ticked. The date and the name fill themselves when the signer finishes, so they
 * are never asked for and never counted. An optional field is counted only once it is done, so the
 * count never asks for something the signer may leave empty.
 */
import type { SignerRequestView } from "./signer-api.ts";

export type SignerField = SignerRequestView["fields"][number];
export type Answers = Readonly<Record<string, string | boolean>>;

/** The longest answer a text field takes; the server refuses a longer one. */
export const MAXIMUM_TEXT_ANSWER = 500;

const SELF_FILLING = new Set<SignerField["kind"]>(["date-signed", "full-name"]);

/** Whether the signer acts on this field at all. */
export function asksTheSigner(field: SignerField): boolean {
  return !SELF_FILLING.has(field.kind);
}

export function fieldDone(field: SignerField, answers: Answers, adopted: boolean): boolean {
  switch (field.kind) {
    case "signature":
    case "initials":
      return adopted;
    case "checkbox":
      return answers[field.id] === true;
    case "text": {
      const answer = answers[field.id];
      return typeof answer === "string" && answer.trim() !== "";
    }
    default:
      return true;
  }
}

/** "2 of 4 fields done": every required field the signer acts on, and every optional one done. */
export function progressOf(
  fields: readonly SignerField[],
  answers: Answers,
  adopted: boolean,
): { readonly done: number; readonly total: number } {
  let done = 0;
  let total = 0;
  for (const field of fields) {
    if (!asksTheSigner(field)) continue;
    const isDone = fieldDone(field, answers, adopted);
    if (!field.required && !isDone) continue;
    total += 1;
    if (isDone) done += 1;
  }
  return { done, total };
}

/** The first required field, in reading order after the given one, that is still to do. */
export function nextFieldToDo(
  fields: readonly SignerField[],
  answers: Answers,
  adopted: boolean,
  after: string | null,
): SignerField | null {
  const waiting = fields.filter(
    (field) => asksTheSigner(field) && field.required && !fieldDone(field, answers, adopted),
  );
  if (waiting.length === 0) return null;
  const from = after === null ? -1 : fields.findIndex((field) => field.id === after);
  return waiting.find((field) => fields.indexOf(field) > from) ?? waiting[0] ?? null;
}

/** Whether Finish can be pressed, and if not, the sentence that says why. */
export function finishRefusal(
  fields: readonly SignerField[],
  answers: Answers,
  adopted: boolean,
): string | null {
  const needsMark = fields.some((field) => field.kind === "signature" || field.kind === "initials");
  if (needsMark && !adopted) return "Adopt your signature first.";
  const left = fields.filter(
    (field) => asksTheSigner(field) && field.required && !fieldDone(field, answers, adopted),
  ).length;
  if (left > 0)
    return left === 1
      ? "One required field is still empty."
      : `${left} required fields are still empty.`;
  return null;
}

/** What Finish sends: each text field's words and each checkbox's state, and nothing else. */
export function answersToSend(
  fields: readonly SignerField[],
  answers: Answers,
): Record<string, string | boolean> {
  const sent: Record<string, string | boolean> = {};
  for (const field of fields) {
    const answer = answers[field.id];
    if (field.kind === "checkbox") sent[field.id] = answer === true;
    else if (field.kind === "text" && typeof answer === "string" && answer.trim() !== "") {
      sent[field.id] = answer.trim().slice(0, MAXIMUM_TEXT_ANSWER);
    }
  }
  return sent;
}

/** Initials from a name: the first letter of each word, at most three. */
export function initialsFrom(name: string): string {
  return name
    .trim()
    .split(/\s+/u)
    .filter((word) => word !== "")
    .map((word) => Array.from(word)[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 3);
}
