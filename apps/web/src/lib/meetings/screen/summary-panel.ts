/*
 * What a recording's summary reads as: where it stands, why it was not written where it was not,
 * what the platform wrote, and the action items it read out of the conversation. The one home for
 * those words, so the recordings list and the summary panel cannot word one summary two ways.
 *
 * A SUMMARY IS WRITTEN FROM A READY TRANSCRIPT, by the model the firm's settings choose, and it
 * stands in one of four places: being written, ready to read, failed with an Error ID, or not written
 * at all because the firm has summaries switched off, because the firm has not switched AI processing
 * on, or because nothing was said. A refusal is a fact about the firm or the recording rather
 * than an error, so it is worded as one and carries no Error ID.
 *
 * A SUMMARY IS OUR CHARACTERIZATION, NOT THE RECORD. The transcript and the audio are what happened;
 * the summary is what the platform made of it. The panel says so in one quiet line above the text, so
 * a reader quoting it never takes it for the transcript.
 *
 * AN OWNER IS NAMED ONLY WHERE THE TRANSCRIPT NAMED A MEMBER EXACTLY. Anything less is left unowned
 * by the server, and the item says "No owner" rather than guessing. A due date is a civil date the
 * transcript stated, drawn through the design system's date formatter so it reads the same in every
 * office.
 *
 * THE WORDS ARE PRIVILEGED. The summary's text and every item's text are drawn on the screen and
 * nowhere else: nothing in this module or the panel writes them to a log, into an address or into a
 * failure report.
 */
import { formatDate } from "@magna-carta/design-system/formatters";
import { permissionRefusal } from "$lib/access/refusal.ts";
import {
  PENDING_TRANSCRIPT_REREAD_MILLISECONDS,
  TRANSCRIPT_WITHHELD_WORDS,
} from "./transcript-panel.ts";
import type {
  MeetingActionItemTaskView,
  MeetingSummaryActionItemView,
  MeetingSummaryHeaderView,
  MeetingSummaryMarkView,
  MeetingSummaryReadView,
  MeetingSummaryRefusalView,
  MeetingSummaryStateView,
  MeetingSummaryWithheldView,
} from "../meetings-api.ts";

/** What each place a summary can stand is called. */
export const SUMMARY_STATE_WORDS: Readonly<Record<MeetingSummaryStateView, string>> = Object.freeze(
  {
    pending: "Being Written",
    ready: "Ready",
    failed: "Could Not Be Written",
    refused: "Not Written",
  },
);

/** What one summary's state is called. */
export function summaryStateWord(summary: { readonly state: MeetingSummaryStateView }): string {
  return SUMMARY_STATE_WORDS[summary.state];
}

/**
 * Why a summary was not written, in a sentence for each reason. A summary sends privileged
 * conversation to a model, so it is written only where the firm has switched AI processing on; the
 * firm's AI settings are named by the page's own title, so a reader who may change them knows where
 * to go.
 */
export const SUMMARY_REFUSAL_WORDS: Readonly<Record<MeetingSummaryRefusalView, string>> =
  Object.freeze({
    disabled: "Meeting summaries are turned off for this firm.",
    "not-eligible":
      "AI isn't turned on for this firm. Turn it on under Settings, in AI and the Assistant.",
    "transcript-empty": "Nothing was said in this recording, so there is nothing to summarize.",
  });

/** What a summary refused for a reason this screen has no words for yet says instead. */
const UNWORDED_REFUSAL = "This summary wasn't written.";

/**
 * The Error ID a failed summary was recorded under, or null where it carries none. Only a FAILED
 * one: a summary being written may be on a retry, and a refusal is not a fault.
 */
export function summaryErrorId(summary: {
  readonly state: MeetingSummaryStateView;
  readonly failureErrorId?: string | null;
}): string | null {
  if (summary.state !== "failed") return null;
  const errorId = summary.failureErrorId ?? null;
  return errorId === null || errorId === "" ? null : errorId;
}

/**
 * What the panel's body shows once the read has answered. ONE function decides it, in one order:
 *
 * - `being-written`: the summary is still being written.
 * - `could-not-be-written`: it failed, with its Error ID where it carries one.
 * - `not-written`: it was refused, with the reason in a sentence.
 * - `withheld`: it is ready, but the read withheld its words because the transcript's document they
 *   were written from can no longer be read. Said in the transcript panel's own words, because it is
 *   the same document standing in the same place.
 * - `summary`: it is ready and its words are shown.
 *
 * The first four are facts about the summary rather than an absence of words, which is why each is
 * the design system's empty state with its own title.
 */
export type SummaryBody =
  | { readonly kind: "summary" }
  | {
      readonly kind: "being-written" | "could-not-be-written" | "not-written" | "withheld";
      /** The empty state's title. */
      readonly title: string;
      /** The one line beneath it, or null where there is nothing more to say. */
      readonly detail: string | null;
    };

export function summaryBody(
  header: Pick<MeetingSummaryHeaderView, "state" | "refusalReason" | "failureErrorId">,
  withheld: MeetingSummaryWithheldView,
): SummaryBody {
  switch (header.state) {
    case "pending":
      return {
        kind: "being-written",
        title: `Summary ${SUMMARY_STATE_WORDS.pending}`,
        detail: null,
      };
    case "failed": {
      // The Error ID is what somebody quotes to support, so it is the one line under the title.
      const errorId = summaryErrorId(header);
      return {
        kind: "could-not-be-written",
        title: `Summary ${SUMMARY_STATE_WORDS.failed}`,
        detail: errorId === null ? null : `Error ID: ${errorId}`,
      };
    }
    case "refused": {
      // Read as a table that may lack a key, because a reason added on the server before this
      // screen learns it must still say something true rather than nothing.
      const words: Readonly<Record<string, string | undefined>> = SUMMARY_REFUSAL_WORDS;
      return {
        kind: "not-written",
        title: `Summary ${SUMMARY_STATE_WORDS.refused}`,
        detail:
          (header.refusalReason === null ? undefined : words[header.refusalReason]) ??
          UNWORDED_REFUSAL,
      };
    }
    case "ready":
      break;
  }
  if (withheld === null) return { kind: "summary" };
  return {
    kind: "withheld",
    title: "Summary Withheld",
    detail: TRANSCRIPT_WITHHELD_WORDS[withheld],
  };
}

/**
 * The one quiet line above a summary's text, so it is never mistaken for the transcript: what the
 * platform wrote is a characterization of the conversation, and the record is the transcript.
 */
export const SUMMARY_CHARACTERIZATION =
  "Written by AI from the transcript. It describes the conversation and isn't a record of it.";

/** What a confirmation to write the summary again says will happen, and what will not. */
export const SUMMARY_RERUN_CONSEQUENCE =
  "The summary and its action items are replaced. Tasks already made from them stay.";

/** Who an action item belongs to, or that it belongs to nobody the transcript named exactly. */
export function actionItemOwnerWords(item: Pick<MeetingSummaryActionItemView, "owner">): string {
  const name = item.owner?.displayName.trim() ?? "";
  return name === "" ? "No owner" : `Owner: ${name}`;
}

/**
 * When an action item is due, through the design system's civil-date formatter, or null where the
 * transcript stated no day. A civil date belongs to no zone, so it reads the same in every office.
 */
export function actionItemDueWords(
  item: Pick<MeetingSummaryActionItemView, "dueOn">,
  locale?: string,
): string | null {
  if (item.dueOn === null || item.dueOn === "") return null;
  return `Due ${formatDate(item.dueOn, locale === undefined ? {} : { locale })}`;
}

/** The action items in the order the summary numbered them. */
export function orderedActionItems(
  items: readonly MeetingSummaryActionItemView[],
): readonly MeetingSummaryActionItemView[] {
  return items.toSorted((left, right) => left.ordinal - right.ordinal);
}

/**
 * Whether the reader may put a task made of this item in its owner's name: where the owner is the
 * reader, or where the reader holds the key to assign. Anybody else's name needs that key, and the
 * route refuses the request outright without it. An item with no owner has no name to put it in.
 */
export function mayAssignToOwner(
  item: Pick<MeetingSummaryActionItemView, "owner">,
  viewerUserId: string | null,
  canAssign: boolean,
): boolean {
  if (item.owner === null) return false;
  return canAssign || item.owner.userId === viewerUserId;
}

/**
 * Whether Create Task asks for the task to be put in the owner's name: only where there is an owner,
 * the reader may, and the reader left the box ticked. Anything else sends `assignToOwner: false`, and
 * the task is made with nobody's name on it.
 */
export function assignsToOwner(
  item: Pick<MeetingSummaryActionItemView, "owner">,
  viewerUserId: string | null,
  canAssign: boolean,
  ticked: boolean,
): boolean {
  return ticked && mayAssignToOwner(item, viewerUserId, canAssign);
}

/**
 * Who the task will be assigned to, as the confirmation states it before anything is made. A
 * participant can name somebody's action item aloud in a meeting, so the person whose task this
 * would become is said in words the reader reads before they press.
 */
export function taskAssigneeWords(
  item: Pick<MeetingSummaryActionItemView, "owner">,
  assign: boolean,
): string {
  const name = item.owner?.displayName.trim() ?? "";
  if (item.owner === null || name === "") return "Not assigned. No owner was named.";
  return assign ? `Assigned to ${name}.` : "Assigned to nobody.";
}

/** What the confirmation says where the owner is another member and the reader may not assign. */
export const MADE_WITHOUT_OWNER_WORDS = permissionRefusal(
  "Putting a task in another member's name",
  "tasks:assign",
);

/** What the row says where somebody else made the task first. */
export const ALREADY_TASKED_WORDS = "Someone already made a task from this item.";

/**
 * The summary as it stands once a task has been made of one item: the item replaced by the one the
 * route answered with, everything else unchanged. Where the summary no longer holds the item (it was
 * written again in between) it is left alone, and the next read says what stands.
 */
export function withTaskMade(
  view: MeetingSummaryReadView,
  made: MeetingActionItemTaskView,
): MeetingSummaryReadView {
  if (!view.actionItems.some((item) => item.id === made.actionItem.id)) return view;
  return {
    ...view,
    actionItems: view.actionItems.map((item) =>
      item.id === made.actionItem.id ? { ...made.actionItem, taskId: made.taskId } : item,
    ),
  };
}

/** How long the panel waits before asking again about a summary still being written. */
export const PENDING_SUMMARY_REREAD_MILLISECONDS = PENDING_TRANSCRIPT_REREAD_MILLISECONDS;

/**
 * Whether a summary that was being written has now settled one way or another. The recordings list
 * is read again at exactly that moment, so the row a reader returns to agrees with the panel.
 */
export function summarySettled(
  before: MeetingSummaryStateView | null,
  now: MeetingSummaryStateView | null,
): boolean {
  return before === "pending" && now !== null && now !== "pending";
}

/**
 * What the recordings list's Summary column says: nothing before there is a summary, "Being
 * Written" while it is written, "Read" where there is one to read, "Could Not Be Written" where it
 * failed, and "Not Written" where it was refused. The panel says why.
 */
export function summaryMarkText(summary: MeetingSummaryMarkView | null): string {
  if (summary === null) return "";
  if (summary.state === "ready") return "Read";
  return summaryStateWord(summary);
}
