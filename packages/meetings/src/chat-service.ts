import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { guarded } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { MeetingMessageId, UserId } from "@magna-carta/identifiers/types";
import type { MeetingId } from "@magna-carta/identifiers/types";
import {
  insertMeetingMessageStatement,
  readMeetingMessage,
  redactMeetingMessageStatement,
} from "./chat-statements.ts";
import type { MeetingMessageEntry } from "./chat-types.ts";
import { assertMessageBody, refuseChat } from "./chat-validation.ts";
import { readMeeting, readOpenAttendance } from "./meeting-statements.ts";
import { refuse } from "./validation.ts";

// The chat's write paths: say something in a room, and take something back.
//
// WHAT MAKES THIS DIFFERENT FROM EVERY OTHER PATH IN THIS PACKAGE. It stores CONTENT. The room, the
// stays and the ceiling are identifiers and instants, and the media never reaches this platform at
// all; a chat message is a thing somebody said, kept on the record by the owner's ruling, so it
// carries a retention basis and a way to be taken back. Nothing else here changes: this module reads
// no clock, holds no binding and calls nothing external — the clock, the actor and the random source
// arrive as options, so a fixture can mint a byte-identical batch.
//
// THE AUDIT ROWS CARRY IDENTIFIERS AND INSTANTS. Never the body, not on the sending and not on the
// removal. What was said is the content this record exists to hold; the audit log is a compliance
// record with its own retention and its own readers, which is the line the call and text log already
// holds for a message body.

/** The label the redaction's guard carries, exported because a caller has to match on it. */
export const REDACT_MESSAGE_GUARD = "meeting.chat.redact";

export interface MeetingChatOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId;
  readonly randomSource?: RandomSource;
  // The same predicate every calendar source composes. A chat has no visibility rule of its own —
  // it inherits the meeting's, which inherits the event's — so this rides the read on the way to
  // every write, and a message cannot be posted into a room a read could not reach.
  readonly visibility: VisibleMatterPredicate;
  /** Whether the caller holds `meetings:host`, which is what lets them moderate somebody else's words. */
  readonly mayHost?: boolean;
}

/**
 * Saying something in a meeting.
 *
 * AN OPEN STAY IS THE WHOLE OF THE PERMISSION, and it is the same row the signaling socket demands
 * and the same row the room's ceiling is counted over. A member who has left cannot post into a
 * meeting they are no longer in, and a member who never joined has nothing to speak from — being in
 * the room is what made the message sayable, which is why the row hangs from the stay rather than
 * from the member.
 */
export async function postMeetingMessage(
  database: SqlDatabase,
  meetingId: MeetingId,
  input: { readonly body: string },
  options: MeetingChatOptions,
): Promise<{ message: MeetingMessageEntry; effect: EffectWrite }> {
  const meeting = await readMeeting(database, meetingId, options.visibility);
  if (meeting === undefined) {
    // The room's own refusal, unchanged: a meeting is reachable only through its event, and a
    // handle that names nothing and one naming a room behind a walled matter are one question.
    refuse("meeting-unknown-event", "that is not a meeting you can reach");
  }
  if (meeting.status === "ended") {
    refuse("meeting-already-ended", "this meeting has ended");
  }

  const stay = await readOpenAttendance(database, meetingId, options.actorUserId);
  if (stay === undefined) {
    // The room's code rather than one of the chat's, so the answer a member gets for speaking from
    // outside the room is the answer they get for signaling from outside it.
    refuse("meeting-not-joined", "you are not in this meeting");
  }

  const body = assertMessageBody(input.body);
  const now = options.clock.now();
  const messageId = newIdentifier("meetingMessage", options.randomSource);
  return {
    message: {
      id: messageId,
      meetingId,
      // The member kind, which is the only one this package writes: an external guest's stay is a
      // different table, and the path that opens one writes its own rows.
      participantKind: "member",
      participantId: stay.id,
      userId: options.actorUserId,
      sentAt: now,
      body,
      redactedAt: null,
      redactedByUserId: null,
    },
    effect: {
      statements: [
        insertMeetingMessageStatement(database, {
          id: messageId,
          meetingId,
          attendanceId: stay.id,
          body,
          now,
        }),
        domainAuditStatement(database, {
          event: "meetings.chat.messageSent",
          subjectId: messageId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // Identifiers and instants, and the LENGTH of what was said rather than any part of it.
          // A count is a fact about the record's size that a retention question can be asked with;
          // the words themselves are the content the audit log must never carry.
          metadata: {
            meetingId,
            participantId: stay.id,
            sentAt: now,
            bodyLength: body.length,
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}

/**
 * Taking a message back — which blanks the body and KEEPS THE ROW, so the file says a message was
 * there and that somebody removed it. A transcript with a silent hole in it is a transcript nobody
 * can rely on.
 *
 * WHO MAY: the host, or the author. A host moderates the room; a member takes back their own words.
 * The author is the member on the message's own stay, resolved through the join rather than read off
 * a column the message does not have.
 *
 * A MESSAGE ALREADY TAKEN BACK IS NOT TAKEN BACK TWICE, and that is a success rather than a refusal:
 * the member asked for it to be gone and it is gone. Writing again would move the instant and the
 * actor a record already carries, which is the leave path's rule about a stay that is already
 * closed — so this produces no statements and says so with `redacted: false`.
 */
export async function redactMeetingMessage(
  database: SqlDatabase,
  meetingId: MeetingId,
  messageId: MeetingMessageId,
  options: MeetingChatOptions,
): Promise<{ redacted: boolean; message: MeetingMessageEntry; effect: EffectWrite }> {
  const meeting = await readMeeting(database, meetingId, options.visibility);
  if (meeting === undefined) {
    refuse("meeting-unknown-event", "that is not a meeting you can reach");
  }

  const message = await readMeetingMessage(database, meetingId, messageId);
  if (message === undefined) {
    refuseChat("meeting-message-not-found", "that is not a message you can reach");
  }

  // A MEETING THAT HAS ENDED IS STILL MODERATED. Unlike posting, this deliberately does not check
  // the meeting's status: the words outlive the gathering, so the need to take one back outlives it
  // too — and a member who said something they regret must not be trapped by the host closing the
  // room.
  // The author is the MEMBER behind the message's stay, which is null for a message said from a
  // guest stay — so a guest's words are the host's to moderate and nobody else's, which is the right
  // answer and falls out of the comparison rather than needing a branch.
  if (options.mayHost !== true && message.userId !== options.actorUserId) {
    refuseChat("meeting-message-not-redactable", "that is not your message to take back");
  }

  if (message.redactedAt !== null) {
    return { redacted: false, message, effect: { statements: [], outboxMessages: [] } };
  }

  const now = options.clock.now();
  return {
    redacted: true,
    message: {
      ...message,
      body: "",
      redactedAt: now,
      redactedByUserId: options.actorUserId,
    },
    effect: {
      statements: [
        guarded(
          redactMeetingMessageStatement(database, {
            id: messageId,
            redactedByUserId: options.actorUserId,
            now,
          }),
          REDACT_MESSAGE_GUARD,
        ),
        domainAuditStatement(database, {
          event: "meetings.chat.messageRedacted",
          subjectId: messageId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // Identifiers and instants. NOT the body — least of all here: an audit row that recorded
          // what a redaction removed would be the one place the removed words survived, which is
          // the opposite of what the member asked for.
          metadata: {
            meetingId,
            participantId: message.participantId,
            sentAt: message.sentAt,
            redactedAt: now,
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}
