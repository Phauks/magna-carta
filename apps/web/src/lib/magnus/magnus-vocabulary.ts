/*
 * The words the Magnus surface says about its own controls and about an attached file. Pure data and
 * pure functions, so a sentence a member acts on can be read in a test rather than only on screen.
 *
 * THREE ORDERS, AND EACH IS THE SERVER'S. The rail sorts by date (newest first, the default), by
 * name, and by the matter a conversation is kept on. Every order is applied to the whole record and
 * the rail pages within it; nothing here re-orders a page. The control renders in the empty state
 * too: a rail with nothing in it still shows how it would be ordered.
 *
 * AN ATTACHMENT'S SENTENCE STATES WHAT THE MODEL SAW. A file attached by reference has one of four
 * outcomes on the most recent question, and a member weighing an answer needs to know which — an
 * answer built without the document it was asked about is a different answer. None of the four says
 * "something went wrong": each says what happened and what the member can do about it.
 */
import {
  formatInstantDate,
  formatMonth,
  formatTimeOfDay,
  readInstant,
} from "@magna-carta/design-system/formatters";
import type { AttachmentTextStatus, ConversationSort, MagnusAttachment } from "./magnus-api.ts";

/** How each order reads on the control, in the order the menu offers them. */
export const CONVERSATION_SORT_LABELS: Readonly<Record<ConversationSort, string>> = Object.freeze({
  date: "Date",
  name: "Name",
  matter: "Matter",
});

/**
 * The orders a rail offers. Inside a matter every conversation is on the same matter, so ordering
 * by matter would order by nothing and is not offered there.
 */
export function offeredSorts(options: { readonly onMatter: boolean }): readonly ConversationSort[] {
  return options.onMatter ? ["date", "name"] : ["date", "name", "matter"];
}

/** The control's own label: what the rail is ordered by right now. */
export function sortControlLabel(sort: ConversationSort): string {
  return `Sort: ${CONVERSATION_SORT_LABELS[sort]}`;
}

/** The name a file reads by, or the honest word for one that has since been deleted. */
export function attachmentName(attachment: MagnusAttachment): string {
  return attachment.name ?? "A deleted file";
}

/**
 * What became of the file's text on the most recent question, in words a member can act on. The
 * byte count is stated for a file that was cut, because "part of it" is a question and "the first
 * 64 KB" is an answer.
 */
export const ATTACHMENT_STATUS_SENTENCES: Readonly<
  Record<AttachmentTextStatus, (attachment: MagnusAttachment) => string>
> = Object.freeze({
  pending: () => "Its text will be sent with the next question.",
  sent: () => "Its text was sent whole with the last question.",
  cut: (attachment) =>
    `Only the first ${formatKilobytes(attachment.textBytes ?? 0)} of its text fit. The rest wasn't sent.`,
  unreadable: (attachment) =>
    attachment.name === null
      ? "The file was deleted, so none of it was sent."
      : "The file has no readable text, so none of it was sent.",
});

export function attachmentStatusSentence(attachment: MagnusAttachment): string {
  return ATTACHMENT_STATUS_SENTENCES[attachment.textStatus](attachment);
}

/** A byte count as a member reads it beside a file: whole kilobytes, never a fraction. */
export function formatKilobytes(bytes: number): string {
  const kilobytes = Math.max(1, Math.round(bytes / 1024));
  return `${String(kilobytes)} KB`;
}

/**
 * The one line the composer owes its reader about what leaves the platform: what the assistant is
 * sent, and which model receives it. It reads differently with attachments than without, because
 * "only what you type" stops being true the moment a file is attached, and a sentence that stayed
 * would be a sentence that lied.
 */
export function composerDisclosureLine(options: {
  readonly onMatter: boolean;
  readonly attachmentCount: number;
  /** True when the author turned on reading their own other conversations on the matter. */
  readonly readsEarlierConversations?: boolean;
}): string {
  const reads =
    options.attachmentCount === 0
      ? "Magnus reads only what you type in this conversation."
      : options.attachmentCount === 1
        ? "Magnus reads what you type in this conversation and the text of the one file attached to it."
        : `Magnus reads what you type in this conversation and the text of the ${String(options.attachmentCount)} files attached to it.`;
  if (!options.onMatter) return reads;
  const earlier =
    options.readsEarlierConversations === true
      ? " It also reads the latest messages of your own other conversations on this matter, as set in the pane."
      : "";
  return `${reads}${earlier} Magnus can't read the rest of the matter: not its other documents, calendar or parties.`;
}

/** Which model answers, as the composer states it beside the disclosure line. */
export function answeringModelLine(
  model:
    | {
        readonly modelId: string;
        readonly displayName?: string;
        readonly zeroDataRetention: boolean;
      }
    | null
    | undefined,
): string {
  if (model === undefined) return "";
  if (model === null) {
    return "Magna Carta no longer offers the model the firm chose. An administrator can choose another in the firm's settings.";
  }
  const name = model.displayName ?? model.modelId;
  return model.zeroDataRetention
    ? `Answered by ${name}, which keeps nothing sent to it.`
    : `Answered by ${name}.`;
}

/**
 * The provider's effort levels as the composer names them. "Extra High" is spelled out rather than
 * the provider's "xhigh", because a menu item is read, not parsed.
 */
export const EFFORT_LABELS: Readonly<Record<string, string>> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

export function effortLabel(effort: string): string {
  return EFFORT_LABELS[effort] ?? effort;
}

/** What the model control reads: the model's name, and the effort where the model takes one. */
export function modelControlLabel(
  model: { readonly displayName: string },
  effort: string | null,
): string {
  return effort === null ? model.displayName : `${model.displayName}, ${effortLabel(effort)}`;
}

/*
 * THE RAIL'S HEADINGS AND ROW LINES (the owner's board, round 2). Under the date order the
 * conversations in no folder are grouped by when they started: Today, Earlier This Week, then one
 * heading per month. The groups only label runs of rows the server already ordered; nothing here
 * moves a row. Under the name order there is one heading, and under the matter order one per matter.
 * The headings are calendar days in the reader's zone, never elapsed time.
 */

/** The calendar day an instant fell on where the reader is, as a comparable number. */
function localDayNumber(date: Date): number {
  return date.getFullYear() * 10_000 + (date.getMonth() + 1) * 100 + date.getDate();
}

/** The Monday that begins the reader's week for a day, as a comparable day number. */
function weekStartNumber(date: Date): number {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const sinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - sinceMonday);
  return localDayNumber(start);
}

/** The heading a conversation started at this instant falls under, read on the given day. */
export function railDateGroup(startedAt: string, now: Date): string {
  const date = readInstant(startedAt);
  if (date === null) return startedAt;
  const day = localDayNumber(date);
  if (day === localDayNumber(now)) return "Today";
  if (day >= weekStartNumber(now) && day < localDayNumber(now)) return "Earlier This Week";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return formatMonth(`${String(date.getFullYear())}-${month}-01`);
}

/** When a row's conversation started: the time of day for today, the date otherwise. */
export function railRowWhen(startedAt: string, now: Date): string {
  const date = readInstant(startedAt);
  if (date === null) return startedAt;
  return localDayNumber(date) === localDayNumber(now)
    ? formatTimeOfDay(startedAt)
    : formatInstantDate(startedAt);
}

/** The line under a row's name: the matter's number, or General, then when it started. */
export function railRowLine(matterNumber: string | null, startedAt: string, now: Date): string {
  return `${matterNumber ?? "General"} · ${railRowWhen(startedAt, now)}`;
}
