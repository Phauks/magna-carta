import { TimeEntryValidationError } from "./time-entry-validation.ts";

// The WIP lifecycle. draft -> (submitted -> approved) -> billed, plus void. The submitted/approved
// states exist only when the firm's review gate is on; with the gate off, a draft bills directly.
// billed and void are terminal — on entering either, the row's business columns freeze (the service
// refuses any UPDATE beyond the billing lock). This is a column-level freeze contract, not the
// ledger's append-only rule: status itself is a mutable column whose legal moves are these.
export type TimeEntryStatus = "draft" | "submitted" | "approved" | "billed" | "void";

// The legal moves, keyed by whether the review gate is on. void is reachable from any non-terminal
// state under either gate; the table below holds only the forward/kick-back moves, with void added
// uniformly in canTransition.
const GATE_ON_TRANSITIONS: ReadonlyMap<TimeEntryStatus, ReadonlySet<TimeEntryStatus>> = new Map([
  ["draft", new Set<TimeEntryStatus>(["submitted"])],
  ["submitted", new Set<TimeEntryStatus>(["approved", "draft"])], // approve or kick back
  ["approved", new Set<TimeEntryStatus>(["billed"])],
]);

const GATE_OFF_TRANSITIONS: ReadonlyMap<TimeEntryStatus, ReadonlySet<TimeEntryStatus>> = new Map([
  ["draft", new Set<TimeEntryStatus>(["billed"])],
]);

// billed and void freeze the row's business columns; no transition leaves them.
export function isFrozen(status: TimeEntryStatus): boolean {
  return status === "billed" || status === "void";
}

export function canTransition(
  from: TimeEntryStatus,
  to: TimeEntryStatus,
  gateOn: boolean,
): boolean {
  if (isFrozen(from)) return false; // nothing leaves a terminal state
  // void is reachable from any non-terminal state regardless of the gate.
  if (to === "void") return true;
  const table = gateOn ? GATE_ON_TRANSITIONS : GATE_OFF_TRANSITIONS;
  return table.get(from)?.has(to) ?? false;
}

export function assertTransition(
  from: TimeEntryStatus,
  to: TimeEntryStatus,
  gateOn: boolean,
): void {
  if (!canTransition(from, to, gateOn)) {
    throw new TimeEntryValidationError(
      "illegal-transition",
      `cannot move a time entry from ${from} to ${to} (review gate ${gateOn ? "on" : "off"})`,
    );
  }
}
