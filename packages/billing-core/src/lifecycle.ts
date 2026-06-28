import { IllegalTransitionError } from "./lifecycle-error.ts";

// The WIP lifecycle. draft -> (submitted -> approved) -> billed, plus void. The submitted/approved
// states exist only when the firm's review gate is on; with the gate off, a draft bills directly.
// billed and void are terminal — on entering either, the row's business columns freeze (the service
// refuses any UPDATE beyond the billing lock). This is a column-level freeze contract, not the
// ledger's append-only rule: status itself is a mutable column whose legal moves are these.
export type BillableStatus = "draft" | "submitted" | "approved" | "billed" | "void";

// The legal moves, keyed by whether the review gate is on. void is reachable from any non-terminal
// state under either gate; the table below holds only the forward/kick-back moves, with void added
// uniformly in canTransition.
const GATE_ON_TRANSITIONS: ReadonlyMap<BillableStatus, ReadonlySet<BillableStatus>> = new Map([
  ["draft", new Set<BillableStatus>(["submitted"])],
  ["submitted", new Set<BillableStatus>(["approved", "draft"])], // approve or kick back
  ["approved", new Set<BillableStatus>(["billed"])],
]);

// submitted and approved are reachable if the firm ran with the gate ON and then turned it OFF.
// Those in-flight entries must be able to drain to billed rather than being permanently stuck.
const GATE_OFF_TRANSITIONS: ReadonlyMap<BillableStatus, ReadonlySet<BillableStatus>> = new Map([
  ["draft", new Set<BillableStatus>(["billed"])],
  ["submitted", new Set<BillableStatus>(["billed"])],
  ["approved", new Set<BillableStatus>(["billed"])],
]);

// billed and void freeze the row's business columns; no transition leaves them.
export function isFrozen(status: BillableStatus): boolean {
  return status === "billed" || status === "void";
}

export function canTransition(from: BillableStatus, to: BillableStatus, gateOn: boolean): boolean {
  if (isFrozen(from)) return false; // nothing leaves a terminal state
  // void is reachable from any non-terminal state regardless of the gate.
  if (to === "void") return true;
  const table = gateOn ? GATE_ON_TRANSITIONS : GATE_OFF_TRANSITIONS;
  return table.get(from)?.has(to) ?? false;
}

export function assertTransition(from: BillableStatus, to: BillableStatus, gateOn: boolean): void {
  if (!canTransition(from, to, gateOn)) {
    throw new IllegalTransitionError(from, to, gateOn);
  }
}
