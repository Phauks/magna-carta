// Thin re-export of the billing-core WIP lifecycle. TimeEntryStatus is an alias of BillableStatus
// so the rest of the timekeeping package compiles unchanged against the shared state machine.
export {
  canTransition,
  isFrozen,
  assertTransition,
  type BillableStatus as TimeEntryStatus,
} from "@magna-carta/billing-core/lifecycle";
