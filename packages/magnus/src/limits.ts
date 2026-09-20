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

// How many files one conversation may carry. A conversation is a question with a few documents
// beside it, not a review set, and the cap is what keeps the per-request text budget below
// meaningful for each of them.
export const CONVERSATION_ATTACHMENTS_MAX = 10;

// The text of every attached file, together, per request. It sits inside the conversation window's
// own byte cap (window.ts), so a question with attachments still transmits a bounded amount, and what
// does not fit is CUT AND SAID rather than silently dropped.
export const ATTACHMENT_TEXT_MAX_BYTES = 65536;

// A source file larger than this is not read at all. Extraction runs on every question that carries
// the attachment, and a file this size is not a document a question is about.
export const ATTACHMENT_SOURCE_MAX_BYTES = 25 * 1024 * 1024;

const decoder = new TextDecoder();

// The longest prefix of `content` that fits `maxBytes` of UTF-8, cut on a character boundary so what
// survives is still text. The input comes back unchanged when it already fits.
export function cutToByteLength(content: string, maxBytes: number): string {
  const bytes = encoder.encode(content);
  if (bytes.length <= maxBytes) return content;
  // A prefix that ends mid-character decodes to a replacement character at its end; it is stripped so
  // the cut reads clean. The character is written as an ESCAPE rather than as itself: a literal
  // U+FFFD inside a regex literal hangs the linter's parser outright, so a file carrying one is
  // silently un-lintable and takes the whole-repository pass down with it.
  return decoder.decode(bytes.subarray(0, maxBytes)).replace(/\uFFFD$/u, "");
}
