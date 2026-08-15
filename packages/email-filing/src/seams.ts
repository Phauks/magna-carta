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
// never body content. STILL A NO-OP, and the reason has changed: `@magna-carta/notifications` has
// shipped, but it SUBSCRIBES to outbox topics rather than accepting a raise, and email filing
// commits no outbox row for a filing. Wiring it is a topic on the filing write path plus one
// registry entry — not a body swap here — and this signature is what marks where that topic goes.

export interface EmailFiledNotification {
  readonly firmId: string;
  readonly matterId: string;
  readonly emailMessageId: string;
}

export function raiseEmailFiledNotification(_notification: EmailFiledNotification): void {
  // Intentionally empty. Whatever eventually delivers this carries only a deep link to the filed
  // email, never the message body.
}

// ── DKIM verdict boundary.
// The parse engine records DKIM / Authentication-Results / Received verbatim with no verdict; the
// verifier that adjudicates them is ./dkim.ts, wired into the capture path as a port so the engine
// keeps its parse-only (and network-free) boundary. This constant remains the value a record holds
// when nothing has adjudicated it — a capture whose verifier port is unwired, and the column default.
//
// Note what the forward/CC entrance can and cannot say: forwarding rewrites headers, so the original
// signature usually will not verify and a `fail` there is a statement about the forwarding hop, not
// about the sender. The add-in entrance reads the original message and preserves it, which is why the
// auto-file "DKIM-authenticated sender" guardrail is scoped to captures that carry an intact original.
export const DKIM_VERDICT_UNVERIFIED = "unverified" as const;
