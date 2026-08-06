// The per-turn content caps.
//
// These are not a performance tuning knob. Bulk content belongs in R2 and never in D1; a chat turn is
// only "not bulk" because something makes it so, and these caps are that something — they are the
// reason a transcript can be a row in the firm's own database rather than an object with a pointer.
// Two consequences follow and both are features: a member cannot paste a deposition into the box and
// silently ship it to a model provider (the request is refused naming the limit, which is a better
// outcome than succeeding), and the total bytes any one conversation can transmit are bounded by
// construction.
//
// The escalation seam is named and not built: if long-form output is ever needed, the turn row gains
// an R2 content pointer alongside the inline column, exactly as the file subsystem already does.
// Nothing in the read path assumes the content is inline except the read path itself.

// A member's own message. Measured in UTF-8 bytes, not characters — the cap has to mean the same
// thing for a paragraph of English and a paragraph of Japanese.
export const MEMBER_TURN_MAX_BYTES = 16384;

// A Magnus answer. Larger than a member turn because an answer legitimately runs longer than the
// question, and still bounded for the same reason.
export const MAGNUS_TURN_MAX_BYTES = 65536;

const encoder = new TextEncoder();

// The UTF-8 byte length of a string. One home, so the route schema, the write path, and the window
// builder all measure the same thing.
export function contentByteLength(content: string): number {
  return encoder.encode(content).length;
}

export function exceedsMemberTurnCap(content: string): boolean {
  return contentByteLength(content) > MEMBER_TURN_MAX_BYTES;
}

export function exceedsMagnusTurnCap(content: string): boolean {
  return contentByteLength(content) > MAGNUS_TURN_MAX_BYTES;
}
