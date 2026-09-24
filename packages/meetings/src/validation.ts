// Every refusal this subsystem raises, as a code the route maps to a problem type. Codes — never
// messages — drive the mapping, so a message can be reworded without changing the contract.
export type MeetingValidationCode =
  // THE ONE REFUSAL FOR EVERY WAY A ROOM CAN BE OUT OF REACH, and the indistinguishability is the
  // point rather than a shortcut. An event that does not exist, an event on a matter the reader may
  // not see, and a meeting handle that names nothing all raise this: a meeting is reachable only
  // through its event, so those are one question with one answer. Telling them apart would make the
  // route an existence oracle for walled matters — ask about an id, learn from the wording whether
  // it is real — which is the rule the call and text log already holds for its own anchor.
  | "meeting-unknown-event"
  // A meeting that has already finished. Terminal and its own refusal, because it is fixed by
  // starting a new meeting rather than by retrying this one.
  | "meeting-already-ended"
  // Asked of a room nobody has walked into yet. Leaving a meeting that never started, and ending one
  // nobody joined, are different mistakes from reaching a room that has closed.
  | "meeting-not-live"
  // The twelfth person is in and the thirteenth is not coming in. Counted over the open attendance
  // rows at the moment of the join.
  | "meeting-room-full"
  // Leaving a room the caller is not in. A stay that was already closed is not closed twice: the
  // second leave would move an instant somebody's record already carries.
  | "meeting-not-joined"
  // The caller holds no live grant on this meeting. ITS OWN REFUSAL rather than the chokepoint's
  // permission answer, because the member holds the permission and the remedy is different:
  // somebody has to hand them the room, or — where nobody is running it — they claim it.
  | "meeting-not-host"
  // Arriving at a door a host has shut. Fixed by somebody unlocking it, which is why it is neither
  // an absence nor a permission answer.
  | "meeting-locked"
  // A member who was put out of this meeting, arriving again. It is the MEETING they are barred
  // from and not the event: a new meeting on the same event is a new room.
  | "meeting-removed"
  // The hundred-and-first arrival at a door a hundred people are already waiting at. Its own
  // refusal rather than the room's, because the two ceilings answer different questions and the
  // remedy differs: a full room needs somebody to leave, a full lobby needs a host to look at the
  // list.
  | "meeting-lobby-full"
  // A host turned this member away at the door, and they are arriving again. The twin of
  // `meeting-removed` — barred entry is one rule with two labels, and only the sentence differs.
  | "meeting-not-admitted"
  // THE GUEST LINK'S OWN FIVE, and each is said to a person holding a CORRECTLY SIGNED token. A
  // token whose signature does not verify never reaches this vocabulary at all — it gets one flat
  // absence at the chokepoint — because somebody guessing at the route must learn nothing. A signed
  // one could only have come from the firm, so its holder is told what they can act on.
  //
  // Signed, but it matches no live invitation: the secret was rotated since it was sent, or the
  // secret does not hash to what the row holds. Fixed by asking the firm for a new link.
  | "guest-link-not-valid"
  // Past the instant computed when the link was minted — a couple of hours after the event ends,
  // and never more than a fortnight after it was sent.
  | "guest-link-expired"
  // A host withdrew it. The row stays, because who was invited is part of the record.
  | "guest-link-revoked"
  // Spent at the door as many times as a link may be. Bounds a link forwarded to a crowd without
  // punishing a guest whose connection keeps dropping.
  | "guest-link-exhausted"
  // Asked to invite somebody the record cannot resolve to a person the firm knows and can write to:
  // not an entity on the event, an entity with no usable address, or an external participant
  // carrying only a name — who is promoted to the Directory deliberately, never as a side effect.
  | "guest-not-invitable"
  // The name typed at the door is empty, or longer than a name at the door may be.
  | "guest-name-not-valid";

export class MeetingValidationError extends Error {
  constructor(
    readonly code: MeetingValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "MeetingValidationError";
  }
}

export function refuse(code: MeetingValidationCode, message: string): never {
  throw new MeetingValidationError(code, message);
}
