import type {
  FileId,
  MeetingId,
  MeetingMessageId,
  UserId,
} from "@magna-carta/identifiers/types";

// WHOSE STAY A MESSAGE WAS SAID FROM. Two kinds because there are two stay TABLES: a firm member's is
// a `meeting_attendance` row and an external guest's is a `meeting_guest_stay` row, which is why the
// handle on the message is carried by value with no foreign key. The vocabulary is the stay's own and
// lives with the stay types; it is re-exported here because every chat reader already takes it from
// this module.
export { MEETING_PARTICIPANT_KINDS, type MeetingParticipantKind } from "./types.ts";
import type { MeetingParticipantKind } from "./types.ts";

// THE MEETING'S ONE STORED CONTENT. Everything else the subsystem holds is identifiers and instants:
// the audio, the video and the screen share are routed between browsers and reach no storage here.
// Chat is kept on the record, so a message carries what a filed message carries — a retention basis,
// a personal-data classification, and a way to take something back that is itself on the record.

// THE CEILING ON ONE MESSAGE. Four thousand characters is a long message and not an essay; a chat
// that could carry a document would be a filing path nothing in this subsystem scans, and the
// document surfaces exist for that. Also a SQLite CHECK on the row, so a body that reaches a write
// without passing through here fails at the database and not only at the validator.
export const MAX_MEETING_MESSAGE_LENGTH = 4000;

/** The most messages one page of a transcript carries. */
export const MAX_MEETING_MESSAGE_PAGE_SIZE = 100;

// One thing somebody said in one room, in the database's own column names.
//
// It names the STAY rather than the member, and that is the shape worth reading twice: the
// participant pair is who said it AT THE TIME, and being in the room is what made it sayable. The
// speaker is reached through the stay, so somebody who dropped off and dialled back in has each
// message attributed to the stay it was actually said in — the same reason attendance is a row per
// stay rather than a flag per person.
//
// The handle is carried BY VALUE and `participant_kind` says which table it belongs to, because a
// member's stay and a guest's stay are two tables: `meeting_attendance.user_id` is NOT NULL, so a
// guest cannot be a row in it, and a foreign key here would have barred every guest from chat.
//
// `redacted_at` and `redacted_by_user_id` are how a message is taken back: the body is blanked and
// the row stays, so the file keeps that a message existed, when, from which stay, and that somebody
// removed it. There is deliberately no update path for the body itself — a record that could be
// rewritten afterwards is not a record of the meeting.
export interface MeetingMessageRow {
  readonly id: MeetingMessageId;
  readonly meeting_id: MeetingId;
  readonly participant_kind: MeetingParticipantKind;
  readonly participant_id: string;
  readonly sent_at: string;
  /** Empty exactly when the row is redacted, which the schema holds from both sides. */
  readonly body: string;
  readonly redacted_at: string | null;
  readonly redacted_by_user_id: UserId | null;
  readonly created_at: string;
}

/**
 * One message as a surface paints it: the row, plus the member behind the stay.
 *
 * `userId` is resolved through the join rather than stored beside the message, for the reason the
 * meeting summary resolves its title through the event — a second copy is a second answer, and the
 * two disagree the first time one of them is corrected. It is NULL for a message said from a guest
 * stay, which is a stay with no firm member behind it at all.
 */
export interface MeetingMessageEntry {
  readonly id: MeetingMessageId;
  readonly meetingId: MeetingId;
  readonly participantKind: MeetingParticipantKind;
  readonly participantId: string;
  readonly userId: UserId | null;
  readonly sentAt: string;
  readonly body: string;
  readonly redactedAt: string | null;
  readonly redactedByUserId: UserId | null;
  /**
   * A file shared with the line: one of the meeting's matter's own files, by its handle and its name
   * now. Null on an ordinary line, once the line is taken back, and once the file is deleted.
   */
  readonly attachedFile: { readonly id: FileId; readonly name: string } | null;
}
