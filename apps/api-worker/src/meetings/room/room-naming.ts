import { announceParticipantUpdated } from "./room-roster.ts";
import { putParticipant, readParticipant, type RoomContext } from "./room-state.ts";

// WHAT SOMEBODY IS CALLED IN THIS MEETING, chosen by them.
//
// The room's participant record is the only place a chosen name lives, so it dies with the room, and
// the meeting's own record of who attended keeps the account's name. The name somebody came in with
// is kept beside the chosen one (`accountName`) for two reasons: the roster carries it so everybody
// can see who a borrowed-looking name belongs to, and a reconnect — which writes the record afresh
// from the socket's attachment — keeps the chosen name rather than quietly undoing it.

/**
 * Sets this participant's name for the meeting, or puts back the one they came in with (`null`).
 *
 * Answers whether anything changed; a name the record already holds is not announced again. The
 * caller has already paced the frame and parsed the name, so nothing here refuses.
 */
export async function renameParticipant(
  room: RoomContext,
  attendanceId: string,
  chosen: string | null,
): Promise<boolean> {
  const changed = await room.ctx.blockConcurrencyWhile(async () => {
    const participant = await readParticipant(room, attendanceId);
    if (participant === undefined) return false;
    const original = participant.accountName ?? participant.displayName;
    // Choosing the original name is the same as putting it back, so the roster stops calling it a
    // rename.
    const next = chosen === null || chosen === original ? null : chosen;
    const displayName = next ?? original;
    const accountName = next === null ? null : original;
    if (
      displayName === participant.displayName &&
      accountName === (participant.accountName ?? null)
    ) {
      return false;
    }
    await putParticipant(room, attendanceId, { ...participant, displayName, accountName });
    return true;
  });
  if (changed) await announceParticipantUpdated(room, attendanceId);
  return changed;
}
