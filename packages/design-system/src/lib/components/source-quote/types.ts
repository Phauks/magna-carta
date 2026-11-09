/**
 * What a quoted source is. Each kind is drawn in its own hue so a reader can tell, before reading a
 * word of it, whether the passage is law the firm can cite, a court's reasoning, or the client's own
 * paper: `statute` (the accent gilt), `case` (the information blue), `file` (neutral, a document the
 * matter holds).
 */
export type SourceQuoteKind = "statute" | "case" | "file";

/**
 * Whether the check on the quote passed. `verified` is drawn in the success hue (the quote matched
 * its source, or a citator found no negative treatment); `unverified` is drawn muted, because a
 * check that has not run is not a warning about the source, only an absence of reassurance.
 */
export type SourceQuoteCheckTone = "verified" | "unverified";
