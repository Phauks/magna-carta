import {
  messageFrame,
  messageRedactedFrame,
  type MeetingChatMessage,
} from "@magna-carta/meeting-protocol/frames";
import { recordMessageRelayed } from "./room-diagnostics.ts";
import { broadcast, broadcastPerViewer, type RoomContext } from "./room-state.ts";

// A COPY OF SOMETHING ALREADY ON THE RECORD, carried to the people in the room.
//
// THE ROUTE IS THE RECORD AND THE ROOM STORES NOTHING ABOUT A MESSAGE. Not the body, not the handle,
// not a count — this module has no storage key and reads none. The transcript is rows in the firm's
// own database written by `apps/api-worker/src/routes/meeting-chat.ts` through the firm-scoped
// data-access layer; what happens here is a relay of a row that has ALREADY committed, so a browser
// reaches the message as it is said rather than on a poller's next tick. A browser that misses one
// is caught up by the read, which is why this path may fail silently and nothing downstream has to
// care. A write that went through the socket instead would put the firm's record in a Durable
// Object's transient storage, which empties when the room does.
//
// IT REACHES WELCOMED SOCKETS AND NEVER THE LOBBY, and that is structural rather than a filter here:
// `broadcast` skips any socket that has not been welcomed, and a waiting socket never is. What is
// being said inside a confidential matter discussion is exactly what somebody standing outside it
// must not reach.
//
// A ROOM WITH NO LIVE SOCKETS IS A NO-OP. The routes address the room after every commit, including
// for a meeting nobody has a socket open on — a member typing from a reconnecting browser, a
// redaction long after the meeting ended — and the answer is a broadcast that reaches nobody and an
// event that is not recorded because there is no room record to correlate it by.

/**
 * Somebody said something, relayed to everybody in the room.
 *
 * BUILT FOR THE READER: a guest's socket is sent the same message with the firm's user identifiers
 * taken out — who said it is the stay, which the roster names, and who took it back is a member a
 * guest has no business being able to identify.
 */
export async function relayMessage(room: RoomContext, message: MeetingChatMessage): Promise<void> {
  const recipientCount = broadcastPerViewer(room, (viewer) =>
    messageFrame(
      viewer === "guest" ? { ...message, userId: null, redactedByUserId: null } : message,
    ),
  );
  await recordMessageRelayed(room, undefined, recipientCount, false);
}

/**
 * A message was taken back: the handle and the instant, so every browser blanks the copy it holds.
 *
 * The body is not sent because there is none — the record's own is already blank — and a whole
 * record would carry an empty string to say what two fields say.
 */
export async function relayMessageRedaction(
  room: RoomContext,
  messageId: string,
  redactedAt: string,
): Promise<void> {
  const recipientCount = broadcast(room, messageRedactedFrame(messageId, redactedAt));
  await recordMessageRelayed(room, undefined, recipientCount, true);
}
