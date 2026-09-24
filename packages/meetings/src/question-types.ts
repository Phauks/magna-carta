import type { MeetingId, MeetingQuestionId, UserId } from "@magna-carta/identifiers/types";
import type { MeetingContributorKind } from "./types.ts";

// A QUESTION IS THE ROOM ASKING THE HOST. Anybody in the room writes one, anybody upvotes one, and a
// host marks it answered as they work through the queue. It is content the meeting produced, on the
// chat message's terms exactly: retained under the matter, personal data, taken back by a redaction
// that blanks the body and keeps the row.

// THE CEILING ON ONE QUESTION. A thousand characters is a question and not a speech. Also a SQLite
// CHECK on the row, so a body that reaches a write without passing through here fails at the database.
export const MAX_MEETING_QUESTION_LENGTH = 1000;

// THE CEILING ON ONE MEETING'S QUEUE, held in the insert's own WHERE. A room's queue is not somewhere
// a firm should be able to accumulate ten thousand rows — and the bound is what makes the queue's
// shape honest: the panel sorts by upvotes in the browser over everything it holds, and five hundred
// is five pages, so it holds all of it rather than guessing about what it does not.
export const MAX_MEETING_QUESTIONS = 500;

/** The most questions one page of the queue carries. */
export const MAX_MEETING_QUESTION_PAGE_SIZE = 100;

// One question, in the database's own column names. It names the STAY it was asked from, by value,
// on the chat message's reasoning; the member behind a member's stay is reached through the join.
export interface MeetingQuestionRow {
  readonly id: MeetingQuestionId;
  readonly meeting_id: MeetingId;
  readonly participant_kind: MeetingContributorKind;
  readonly participant_id: string;
  /** Empty exactly when the row is redacted, which the schema holds from both sides. */
  readonly body: string;
  readonly asked_at: string;
  readonly answered_at: string | null;
  readonly answered_by_user_id: UserId | null;
  readonly redacted_at: string | null;
  readonly redacted_by_user_id: UserId | null;
  readonly breakout_id: string | null;
  readonly created_at: string;
}

/**
 * One question as a surface paints it: the row, the member behind the stay (null for a guest), how
 * many upvotes it holds, and whether the CALLER has upvoted it — which is what draws the control.
 *
 * `upvotes` is counted over the upvote rows on every read rather than stored, so there is no second
 * home for the number to drift from when somebody withdraws.
 */
export interface MeetingQuestionEntry {
  readonly id: MeetingQuestionId;
  readonly meetingId: MeetingId;
  readonly participantKind: MeetingContributorKind;
  readonly participantId: string;
  readonly userId: UserId | null;
  readonly body: string;
  readonly askedAt: string;
  readonly answeredAt: string | null;
  readonly answeredByUserId: UserId | null;
  readonly redactedAt: string | null;
  readonly redactedByUserId: UserId | null;
  readonly upvotes: number;
  readonly upvotedByCaller: boolean;
}
