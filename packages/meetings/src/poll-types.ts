import type {
  MeetingId,
  MeetingPollId,
  MeetingPollOptionId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { MeetingContributorKind } from "./types.ts";

// A POLL IS A HOST ASKING THE ROOM A CLOSED QUESTION AND SEEING THE ANSWERS. It is opened by a host,
// answered by anybody in the room, closed by a host, and on the record from the moment it opens —
// the question, the options, who answered and what the answers were, on chat's own terms.

// THE CEILINGS, each also a SQLite CHECK on its row so a value that reaches a write without passing
// through the validator fails at the database too.
//
// Five hundred characters is a question and not a brief; two hundred is a choice and not a
// paragraph. Two options is the least a question can offer and still be a choice; ten is as many as
// anybody reads on a card in a meeting.
export const MAX_MEETING_POLL_QUESTION_LENGTH = 500;
export const MAX_MEETING_POLL_OPTION_LENGTH = 200;
export const MIN_MEETING_POLL_OPTIONS = 2;
export const MAX_MEETING_POLL_OPTIONS = 10;

/**
 * WHAT KIND OF QUESTION A POLL ASKS. `one` picks a single option and `multiple` up to `max_choices`;
 * `ranking` puts every option in order, so its tally carries each option's average place; `score` is
 * a rating whose options are the points of the scale, "1" upward, so its average is read off the
 * ordinary tally.
 */
export const MEETING_POLL_KINDS = Object.freeze(["one", "multiple", "ranking", "score"] as const);
export type MeetingPollKind = (typeof MEETING_POLL_KINDS)[number];

/** The scale a score poll offers by default, and the widest it may be (one option per point). */
export const DEFAULT_MEETING_POLL_SCORE_SCALE = 5;

/** The most polls one page of a meeting's polls carries. */
export const MAX_MEETING_POLL_PAGE_SIZE = 50;

/** The most respondents one page of the attributed-answers read carries. */
export const MAX_MEETING_POLL_ANSWER_PAGE_SIZE = 100;

// One poll, in the database's own column names. There is no draft and no update path for the
// question or the options: a poll row exists because somebody was asked, and what they were asked
// does not change afterwards.
export interface MeetingPollRow {
  readonly id: MeetingPollId;
  readonly meeting_id: MeetingId;
  readonly asked_by_user_id: UserId;
  readonly question: string;
  /** 0 or 1 as stored. Whether the answers are kept without the participant. */
  readonly anonymous: number;
  readonly max_choices: number;
  readonly kind: MeetingPollKind;
  readonly opened_at: string;
  readonly closed_at: string | null;
  readonly closed_by_user_id: UserId | null;
  readonly breakout_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** One option's standing: what it says, where it sits, and how many chose it. */
export interface MeetingPollOptionTally {
  readonly optionId: MeetingPollOptionId;
  readonly position: number;
  readonly label: string;
  readonly count: number;
  /** On a ranking, the average place participants gave this option (1 is first); otherwise null. */
  readonly averageRank: number | null;
}

/**
 * WHERE A POLL STANDS: one count per option in `position` order, including the options nobody chose,
 * and how many took part.
 *
 * `respondents` is counted over the participations rather than over the answers — on a poll that lets
 * somebody choose three, one person is three answers and one respondent, and "12 of 30 answered" is
 * a sentence about people.
 */
export interface MeetingPollTally {
  readonly pollId: MeetingPollId;
  readonly options: readonly MeetingPollOptionTally[];
  readonly respondents: number;
}

/**
 * One poll as a surface paints it: the row, its tally, and whether the CALLER has already answered —
 * which is what decides whether their card shows the options or the result.
 *
 * `answeredByCaller` is asked of the member rather than of one stay, so somebody who dropped off and
 * dialled back in still sees the card they answered from.
 */
export interface MeetingPollEntry {
  readonly id: MeetingPollId;
  readonly meetingId: MeetingId;
  readonly askedByUserId: UserId;
  readonly question: string;
  readonly anonymous: boolean;
  readonly maxChoices: number;
  readonly kind: MeetingPollKind;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly closedByUserId: UserId | null;
  readonly options: readonly MeetingPollOptionTally[];
  readonly respondents: number;
  readonly answeredByCaller: boolean;
}

/**
 * One participation on a poll that shows names, as the attributed-answers read returns it: the stay,
 * the member behind it (null for a guest), what it chose, and when.
 *
 * Never produced for a poll that does not show names — its answer rows carry no participant, so there
 * is nothing to join, which is the promise kept by the row rather than by this read.
 */
export interface MeetingPollAttributedAnswer {
  readonly participantKind: MeetingContributorKind;
  readonly participantId: string;
  readonly userId: UserId | null;
  readonly optionIds: readonly MeetingPollOptionId[];
  readonly answeredAt: string;
}
