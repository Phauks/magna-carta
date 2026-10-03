import { isCivilDate } from "@magna-carta/civil-time/civil-date";
import type { UserId } from "@magna-carta/identifiers/types";
import { z } from "zod";
import {
  participantName,
  SUMMARY_ACTION_ITEM_TEXT_MAXIMUM_CHARACTERS,
  SUMMARY_ACTION_ITEMS_MAXIMUM,
  SUMMARY_TEXT_MAXIMUM_CHARACTERS,
} from "./summary-prompt.ts";
import type { ParsedActionItem, ParsedSummary } from "./summary-types.ts";

// A MODEL'S ANSWER READ INTO A SUMMARY AND ITS ACTION ITEMS — or refused.
//
// The answer is the structure `summary-prompt.ts` documents and asks for: one JSON object with exactly a
// `summary` string and an `actionItems` array of objects with exactly `text`, `owner`, `dueOn` and
// `dueOnStated`. Anything else is REFUSED with a closed reason, never repaired: a summary whose shape had
// to be guessed is one whose action items — somebody's obligations — were guessed too. The one envelope
// accepted around the object is a single Markdown code fence wrapping the whole answer (```json … ```),
// which some models add whatever they are told; it is stripped only when it wraps everything.
//
// TWO FACTS ARE NEVER TAKEN ON THE MODEL'S WORD:
//
//   - WHO OWES IT. An owner is linked to a member only when the name the model gave is EXACTLY — byte for
//     byte — the name of one participant the transcript knows, and that participant is a member. A name
//     that differs in case, spacing or completeness, a guest, or a name two members share leaves the item
//     unowned: a summary guessing who owes what is worse than one that leaves it open.
//   - WHEN IT IS DUE. A due date is kept only when it is a real calendar date, the model quoted the words
//     that state it, those words appear verbatim in the transcript the model was sent, and they carry the
//     date's day of the month as a number. "Next Friday" carries no number and is dropped; a date whose
//     quoted words name a different day is dropped. The item itself is kept either way.
//
// NOTHING HERE LOGS, and a refusal carries a closed reason and never a fragment of the answer.

/** Why an answer could not be read. Each is a fixed label; none carries any of the answer's text. */
export const SUMMARY_ANSWER_REFUSALS = Object.freeze([
  "empty",
  "not-json",
  "wrong-shape",
  "summary-empty",
  "summary-too-long",
  "too-many-action-items",
  "action-item-empty",
  "action-item-too-long",
] as const);
export type SummaryAnswerRefusal = (typeof SUMMARY_ANSWER_REFUSALS)[number];

const actionItemSchema = z
  .object({
    text: z.string(),
    owner: z.string().nullable(),
    dueOn: z.string().nullable(),
    dueOnStated: z.string().nullable(),
  })
  .strict();

const answerSchema = z
  .object({
    summary: z.string(),
    actionItems: z.array(actionItemSchema),
  })
  .strict();

/** One action item exactly as the model gave it, its owner still a name and its date still a claim. */
export interface SummaryAnswerActionItem {
  readonly text: string;
  readonly owner: string | null;
  readonly dueOn: string | null;
  readonly dueOnStated: string | null;
}

/** An answer that has the documented structure, before its owners and dates are checked. */
export interface SummaryAnswer {
  readonly summary: string;
  readonly actionItems: readonly SummaryAnswerActionItem[];
}

export type SummaryAnswerReading =
  | { readonly ok: true; readonly answer: SummaryAnswer }
  | { readonly ok: false; readonly refusal: SummaryAnswerRefusal };

// The answer with a single code fence around the whole of it taken off — and nothing else touched.
function withoutWrappingFence(answer: string): string {
  const trimmed = answer.trim();
  const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*)\r?\n```$/u.exec(trimmed);
  return fenced === null ? trimmed : (fenced[1] ?? "").trim();
}

/**
 * READS AN ANSWER'S STRUCTURE: the one JSON object, its keys exactly the documented ones, its summary and
 * every item's text present and inside their limits. Text is trimmed at its ends and otherwise kept as
 * written.
 */
export function readSummaryAnswer(answer: string): SummaryAnswerReading {
  const body = withoutWrappingFence(answer);
  if (body === "") return { ok: false, refusal: "empty" };
  if (!body.startsWith("{") || !body.endsWith("}")) return { ok: false, refusal: "not-json" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, refusal: "not-json" };
  }
  const shaped = answerSchema.safeParse(parsed);
  if (!shaped.success) return { ok: false, refusal: "wrong-shape" };
  const summary = shaped.data.summary.trim();
  if (summary === "") return { ok: false, refusal: "summary-empty" };
  if (summary.length > SUMMARY_TEXT_MAXIMUM_CHARACTERS) {
    return { ok: false, refusal: "summary-too-long" };
  }
  if (shaped.data.actionItems.length > SUMMARY_ACTION_ITEMS_MAXIMUM) {
    return { ok: false, refusal: "too-many-action-items" };
  }
  const actionItems: SummaryAnswerActionItem[] = [];
  for (const item of shaped.data.actionItems) {
    const text = item.text.trim();
    if (text === "") return { ok: false, refusal: "action-item-empty" };
    if (text.length > SUMMARY_ACTION_ITEM_TEXT_MAXIMUM_CHARACTERS) {
      return { ok: false, refusal: "action-item-too-long" };
    }
    actionItems.push({
      text,
      owner: item.owner,
      dueOn: item.dueOn,
      dueOnStated: item.dueOnStated,
    });
  }
  return { ok: true, answer: { summary, actionItems } };
}

/** A participant an owner may be matched against: the name the transcript knows, and the member, if any. */
export interface SummaryParticipant {
  readonly displayName: string;
  // Null for a guest: a guest is named in the transcript but is not a member a task can be assigned to.
  readonly userId: UserId | null;
}

/**
 * The member an owner's name names EXACTLY — or null. The names compared are the ones the model was given
 * (`participantName`, a name on one line), and a name two different members share names nobody.
 */
export function exactOwner(
  owner: string | null,
  participants: readonly SummaryParticipant[],
): UserId | null {
  if (owner === null || owner === "") return null;
  const named = new Set<UserId | null>(
    participants
      .filter((participant) => participantName(participant.displayName) === owner)
      .map((participant) => participant.userId),
  );
  if (named.size !== 1) return null;
  const [userId] = named;
  return userId ?? null;
}

/**
 * The due date, when the transcript itself states it: a real calendar date, quoted words that appear in
 * `transcriptText` verbatim, and those words carrying the date's day of the month. Null otherwise.
 */
export function statedDueOn(
  dueOn: string | null,
  dueOnStated: string | null,
  transcriptText: string,
): string | null {
  if (dueOn === null || dueOnStated === null || !isCivilDate(dueOn)) return null;
  const stated = dueOnStated.trim();
  if (stated === "" || !transcriptText.includes(stated)) return null;
  const day = Number(dueOn.slice(8, 10));
  const carriesTheDay = new RegExp(`(?<![0-9])0?${String(day)}(?![0-9])`, "u").test(stated);
  return carriesTheDay ? dueOn : null;
}

/** The summary to write: an answer's structure, with its owners and dates held to the transcript. */
export function settleSummaryAnswer(
  answer: SummaryAnswer,
  context: {
    readonly participants: readonly SummaryParticipant[];
    readonly transcriptText: string;
  },
): ParsedSummary {
  return {
    summaryText: answer.summary,
    actionItems: answer.actionItems.map(
      (item): ParsedActionItem => ({
        text: item.text,
        ownerUserId: exactOwner(item.owner, context.participants),
        dueOn: statedDueOn(item.dueOn, item.dueOnStated, context.transcriptText),
      }),
    ),
  };
}

export type SummaryParse =
  | { readonly ok: true; readonly summary: ParsedSummary }
  | { readonly ok: false; readonly refusal: SummaryAnswerRefusal };

/** READS A FINAL ANSWER INTO THE SUMMARY TO WRITE, or refuses it. */
export function parseSummaryAnswer(
  answer: string,
  context: {
    readonly participants: readonly SummaryParticipant[];
    readonly transcriptText: string;
  },
): SummaryParse {
  const reading = readSummaryAnswer(answer);
  if (!reading.ok) return reading;
  return { ok: true, summary: settleSummaryAnswer(reading.answer, context) };
}
