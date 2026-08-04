// The seams later slices need, placed at their call sites now so the machinery behind them drops in as
// a body swap, not a new call path through the capture code. Each is deliberately a no-op today; a
// fitness function can already assert the dangerous act (filing) cannot happen without traversing the
// conflict hook.

// ── Filing-time conflict / ethical-wall hook.
// Called every time an email is filed to a matter (a link promoted stage → filed). Today it returns
// "no conflict" unconditionally; the conflicts engine drops in behind this signature, matching the
// matter's parties and the email's participants against the blind index without decrypting.

export interface FilingConflictInput {
  readonly firmId: string;
  readonly matterId: string;
  readonly emailMessageId: string;
  // The participant addresses on the message, for the future conflict match against the matter's
  // parties. Passed now so the engine needs no new plumbing when it lands.
  readonly participantAddresses: readonly string[];
}

export interface FilingConflictResult {
  readonly hasConflict: boolean;
  // A human-facing reason when a conflict holds filing for review; empty while the engine is a no-op.
  readonly holds: readonly string[];
}

export function checkFilingConflict(_input: FilingConflictInput): FilingConflictResult {
  return { hasConflict: false, holds: [] };
}

// ── Notifications raise-point.
// "email filed to matter" is a notification type raised off the hot path, carrying a deep link and
// never body content. A no-op until the Notifications subsystem ships; the raise site is placed now.

export interface EmailFiledNotification {
  readonly firmId: string;
  readonly matterId: string;
  readonly emailMessageId: string;
}

export function raiseEmailFiledNotification(_notification: EmailFiledNotification): void {
  // Intentionally empty: the Notifications subsystem consumes this raise site when it ships. It will
  // carry only a deep link to the filed email, never the message body.
}

// ── DKIM verdict boundary.
// The parse engine records DKIM / Authentication-Results / Received verbatim with no verdict. The
// record's dkim_verdict stays `unverified`; the cryptographic verifier that fills it is a named future
// consumer reached through this constant, not built here. (Forwarding breaks the original DKIM, so the
// forward/CC path could only ever authenticate the forwarding user — the add-in path preserves the
// original for a real verdict.)
export const DKIM_VERDICT_UNVERIFIED = "unverified" as const;
