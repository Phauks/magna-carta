import type { BillableStatus } from "./lifecycle.ts";

// A move that the WIP state machine refuses. Domain packages catch this and re-throw their own
// validation error (TimeEntryValidationError / CostValidationError) so the HTTP layer maps it to 409.
export class IllegalTransitionError extends Error {
  constructor(
    readonly from: BillableStatus,
    readonly to: BillableStatus,
    readonly gateOn: boolean,
  ) {
    super(
      `cannot move a billable item from ${from} to ${to} (review gate ${gateOn ? "on" : "off"})`,
    );
    this.name = "IllegalTransitionError";
  }
}
