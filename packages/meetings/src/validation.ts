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
  | "meeting-removed";

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
