import { z } from "zod";
import { REPORTED_RUN_STATUSES } from "./check-run.ts";

// The conflicts wire shapes that live with the domain rather than inside a route module. A route
// imports them and the OpenAPI document reads them exactly as written here.

// What a run was asked to search, as it was asked: readable from the moment it is queued, so a
// running check can say what it is searching before it has a record. The record's own scope says
// what actually ran once the firm's floor has been applied. Null on a run whose stored request
// cannot be read.
export const AskedScope = z
  .object({
    sources: z.array(z.string()),
    strictness: z.string(),
  })
  .nullable();

// A cancel's answer: `cancelled` when the request stopped the run; otherwise how it had already
// settled, so a press that lost the race to the run finishing says what actually happened.
export const CancelledRun = z.object({
  id: z.string(),
  status: z.enum(REPORTED_RUN_STATUSES),
});
