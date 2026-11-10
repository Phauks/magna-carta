import { z } from "zod";
import { REPORTED_RUN_STATUSES } from "./check-run.ts";
import {
  FILE_MATTER_STATUSES,
  FOUND_IN_KINDS,
  MESSAGING_CHANNELS,
  TASK_MATTER_STATUSES,
} from "./content-search.ts";

// The conflicts wire shapes that live with the domain rather than inside a route module. A route
// imports them and the OpenAPI document reads them exactly as written here.

// What a run was asked to search, as it was asked: readable from the moment it is queued, so a
// running check can say what it is searching before it has a record. The record's own scope says
// what actually ran once the firm's floor has been applied. Null on a run whose stored request
// cannot be read.
// The firm's own records a check is asked to search beyond the Directory. An empty list, or false,
// is a place not asked for.
export const PlacesRequest = z.object({
  messaging: z.array(z.enum(MESSAGING_CHANNELS)).max(MESSAGING_CHANNELS.length),
  tasks: z.array(z.enum(TASK_MATTER_STATUSES)).max(TASK_MATTER_STATUSES.length),
  magnus: z.boolean(),
  // Optional so a request written before Files could be searched still reads, as not asking for it.
  files: z.array(z.enum(FILE_MATTER_STATUSES)).max(FILE_MATTER_STATUSES.length).optional(),
});

export const AskedScope = z
  .object({
    sources: z.array(z.string()),
    strictness: z.string(),
    places: PlacesRequest,
  })
  .nullable();

// Where in the firm's own records a result was found: the record's kind and handle, the matter it is
// filed on and that matter's number, and when it happened. Never its text: the reader opens the
// record through its own surface. Null on a Directory result.
export const FoundIn = z
  .object({
    kind: z.enum(FOUND_IN_KINDS),
    id: z.string(),
    matterId: z.string().nullable(),
    matterNumber: z.string().nullable(),
    at: z.string().nullable(),
  })
  .nullable();

// A cancel's answer: `cancelled` when the request stopped the run; otherwise how it had already
// settled, so a press that lost the race to the run finishing says what actually happened.
export const CancelledRun = z.object({
  id: z.string(),
  status: z.enum(REPORTED_RUN_STATUSES),
});
