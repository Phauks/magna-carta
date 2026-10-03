import { isCivilDate } from "@magna-carta/civil-time/civil-date";
import type { UserId } from "@magna-carta/identifiers/types";
import { z } from "zod";
import {
  participantName,
  SUMMARY_ACTION_ITEM_TEXT_MAXIMUM_CHARACTERS,
  SUMMARY_ACTION_ITEMS_MAXIMUM,
  SUMMARY_RUN_ACTION_ITEMS_MAXIMUM,
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
//     that state it, and those words are SPOKEN WORDS — found inside what one person said on one line,
//     never in the `HH:MM:SS Name:` the model read before them — that name the date's day AND its month:
//     the month by name ("14 November", "November 14th") or the two together in figures that can be read
//     only one way ("14/11", "2026-11-14"). A year in the words must be the date's year; with none, the
//     date must fall in the years the summary could mean. "Next Friday" names no day and is dropped; "by
//     the 14th" names no month and is dropped; "3/12" is the 3rd of December or the 12th of March and is
//     dropped; a clock time ("00:14:03") is never a date. The item itself is kept either way.
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

// The combining call's answer: the summary alone, because the parts' action items never pass through it.
const combinedAnswerSchema = z.object({ summary: z.string() }).strict();

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

// The one JSON object an answer must be — or the reason it is not.
function jsonObjectOf(
  answer: string,
):
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly refusal: SummaryAnswerRefusal } {
  const body = withoutWrappingFence(answer);
  if (body === "") return { ok: false, refusal: "empty" };
  if (!body.startsWith("{") || !body.endsWith("}")) return { ok: false, refusal: "not-json" };
  try {
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch {
    return { ok: false, refusal: "not-json" };
  }
}

// A summary's prose, trimmed, or the reason it cannot be kept.
function summaryProse(
  summary: string,
):
  | { readonly ok: true; readonly summary: string }
  | { readonly ok: false; readonly refusal: SummaryAnswerRefusal } {
  const trimmed = summary.trim();
  if (trimmed === "") return { ok: false, refusal: "summary-empty" };
  if (trimmed.length > SUMMARY_TEXT_MAXIMUM_CHARACTERS) {
    return { ok: false, refusal: "summary-too-long" };
  }
  return { ok: true, summary: trimmed };
}

export type CombinedSummaryReading =
  | { readonly ok: true; readonly summary: string }
  | { readonly ok: false; readonly refusal: SummaryAnswerRefusal };

/**
 * READS THE COMBINING CALL'S ANSWER: the one JSON object with exactly a `summary` string, inside its limit.
 */
export function readCombinedSummaryAnswer(answer: string): CombinedSummaryReading {
  const json = jsonObjectOf(answer);
  if (!json.ok) return json;
  const shaped = combinedAnswerSchema.safeParse(json.value);
  if (!shaped.success) return { ok: false, refusal: "wrong-shape" };
  return summaryProse(shaped.data.summary);
}

/**
 * READS AN ANSWER'S STRUCTURE: the one JSON object, its keys exactly the documented ones, its summary and
 * every item's text present and inside their limits. Text is trimmed at its ends and otherwise kept as
 * written.
 */
export function readSummaryAnswer(answer: string): SummaryAnswerReading {
  const json = jsonObjectOf(answer);
  if (!json.ok) return json;
  const shaped = answerSchema.safeParse(json.value);
  if (!shaped.success) return { ok: false, refusal: "wrong-shape" };
  const prose = summaryProse(shaped.data.summary);
  if (!prose.ok) return prose;
  const summary = prose.summary;
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

/** What a due date is checked against: the words said, and the years a date stated without one may mean. */
export interface DueDateContext {
  // What each person said, line by line, exactly as the model read it after the line's time and name
  // (`spokenWords`). A quoted date must fall inside one of these.
  readonly speech: readonly string[];
  // The years a date stated without its year may fall in, inclusive.
  readonly earliestYear: number;
  readonly latestYear: number;
}

// The months by name. A full name is read in any case, except "May", which is read only capitalized,
// because "we may" is far more common in a meeting than the month; an abbreviation is read only
// capitalized ("Nov", "Nov."), for the same reason ("mar", "dec" and "jan" are fragments of words).
const MONTH_NAMES: readonly (readonly string[])[] = [
  ["january", "Jan"],
  ["february", "Feb"],
  ["march", "Mar"],
  ["april", "Apr"],
  ["May"],
  ["june", "Jun"],
  ["july", "Jul"],
  ["august", "Aug"],
  ["september", "Sept", "Sep"],
  ["october", "Oct"],
  ["november", "Nov"],
  ["december", "Dec"],
];

// The months (1-12) the words name.
function monthsNamed(words: string): ReadonlySet<number> {
  const named = new Set<number>();
  MONTH_NAMES.forEach((names, index) => {
    for (const name of names) {
      const caseless = name === name.toLowerCase();
      const pattern = new RegExp(`(?<!\\p{L})${name}(?!\\p{L})`, caseless ? "iu" : "u");
      if (pattern.test(words)) named.add(index + 1);
    }
  });
  return named;
}

// Whether a day of the month and a month form a date some year has.
function isDayOfMonth(day: number, month: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

// What the words say about the date's day and month: `stated` (they name both, one way only), `other`
// (they name a different date, or one that reads two ways), or `silent` (they name no month).
function dayAndMonthIn(
  words: string,
  date: { readonly year: number; readonly month: number; readonly day: number },
): "stated" | "other" | "silent" {
  // A date in figures, year first: it reads one way only.
  const yearFirst = [
    ...words.matchAll(/(?<![0-9])([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?![0-9])/gu),
  ];
  for (const match of yearFirst) {
    const same =
      Number(match[1]) === date.year &&
      Number(match[2]) === date.month &&
      Number(match[3]) === date.day;
    if (!same) return "other";
  }
  if (yearFirst.length > 0) return "stated";
  // A date in figures, day and month in either order: it must read as this date one way, and as no
  // other date the other way.
  const figures = [
    ...words.matchAll(
      /(?<![0-9])([0-9]{1,2})[./-]([0-9]{1,2})(?:[./-]([0-9]{4}|[0-9]{2}))?(?![0-9])/gu,
    ),
  ];
  for (const match of figures) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    const dayFirst = first === date.day && second === date.month;
    const monthFirst = first === date.month && second === date.day;
    if (!dayFirst && !monthFirst) return "other";
    const otherReading = dayFirst ? isDayOfMonth(second, first) : isDayOfMonth(first, second);
    if (first !== second && otherReading) return "other";
    const shortYear = match[3];
    if (shortYear?.length === 2 && Number(shortYear) !== date.year % 100) return "other";
  }
  if (figures.length > 0) return "stated";
  // A month by name, with the day as a number beside it somewhere in the words.
  const months = monthsNamed(words);
  if (months.size === 0) return "silent";
  if (!months.has(date.month)) return "other";
  const day = new RegExp(`(?<![0-9])0?${String(date.day)}(?:st|nd|rd|th)?(?![0-9])`, "u");
  return day.test(words) ? "stated" : "other";
}

/**
 * The due date, when what somebody said states it: a real calendar date, quoted words found inside one
 * spoken line, no clock time among them, the date's day and month named in them one way only, and its
 * year either named in them or within the years the summary could mean. Null otherwise.
 */
export function statedDueOn(
  dueOn: string | null,
  dueOnStated: string | null,
  context: DueDateContext,
): string | null {
  if (dueOn === null || dueOnStated === null || !isCivilDate(dueOn)) return null;
  const stated = dueOnStated.trim();
  if (stated === "" || !context.speech.some((line) => line.includes(stated))) return null;
  // A clock time — the model's own line prefix, or a time somebody said — is never a date's evidence.
  if (/[0-9]\s*:\s*[0-9]{2}/u.test(stated)) return null;
  const date = {
    year: Number(dueOn.slice(0, 4)),
    month: Number(dueOn.slice(5, 7)),
    day: Number(dueOn.slice(8, 10)),
  };
  const years = [...stated.matchAll(/(?<![0-9])([0-9]{4})(?![0-9])/gu)].map((match) =>
    Number(match[1]),
  );
  if (years.some((year) => year !== date.year)) return null;
  if (years.length === 0 && (date.year < context.earliestYear || date.year > context.latestYear)) {
    return null;
  }
  return dayAndMonthIn(stated, date) === "stated" ? dueOn : null;
}

/** The summary to write: an answer's structure, with its owners and dates held to the transcript. */
export interface SummarySettleContext extends DueDateContext {
  readonly participants: readonly SummaryParticipant[];
}

export function settleSummaryAnswer(
  answer: SummaryAnswer,
  context: SummarySettleContext,
): ParsedSummary {
  return {
    summaryText: answer.summary,
    actionItems: answer.actionItems.map(
      (item): ParsedActionItem => ({
        text: item.text,
        ownerUserId: exactOwner(item.owner, context.participants),
        dueOn: statedDueOn(item.dueOn, item.dueOnStated, context),
      }),
    ),
  };
}

/**
 * A LONG TRANSCRIPT'S SUMMARY TO WRITE: the combining call's account, and every part's action items as
 * the parts gave them, in order — held to the transcript exactly as one call's would be. Refused when the
 * parts together list more than one summary may hold.
 */
export function settlePartedSummary(
  combinedSummary: string,
  parts: readonly SummaryAnswer[],
  context: SummarySettleContext,
): SummaryParse {
  const actionItems = parts.flatMap((part) => part.actionItems);
  if (actionItems.length > SUMMARY_RUN_ACTION_ITEMS_MAXIMUM) {
    return { ok: false, refusal: "too-many-action-items" };
  }
  return {
    ok: true,
    summary: settleSummaryAnswer({ summary: combinedSummary, actionItems }, context),
  };
}

export type SummaryParse =
  | { readonly ok: true; readonly summary: ParsedSummary }
  | { readonly ok: false; readonly refusal: SummaryAnswerRefusal };

/** READS A FINAL ANSWER INTO THE SUMMARY TO WRITE, or refuses it. */
export function parseSummaryAnswer(answer: string, context: SummarySettleContext): SummaryParse {
  const reading = readSummaryAnswer(answer);
  if (!reading.ok) return reading;
  return { ok: true, summary: settleSummaryAnswer(reading.answer, context) };
}
