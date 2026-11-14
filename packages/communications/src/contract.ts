import { z } from "zod";
import { identifierField } from "@magna-carta/identifiers/field";
import { MAX_TASK_TITLE_LENGTH } from "@magna-carta/tasks/types";
import {
  CALL_OUTCOMES,
  COMMUNICATION_CHANNELS,
  COMMUNICATION_DIRECTIONS,
  COMMUNICATION_DISPOSITIONS,
  MAX_CALL_DURATION_SECONDS,
  MAX_CALLER_ID_NAME_LENGTH,
  MAX_COMMUNICATION_BODY_LENGTH,
  MAX_COMMUNICATION_SUMMARY_LENGTH,
  MAX_COUNTERPARTY_NUMBER_LENGTH,
  SPAM_KINDS,
} from "./types.ts";

// The call and text log's contract: what its API accepts in a request body and returns in a
// response, as plain zod. Each component is named with zod's own metadata (`.meta({ id })`), which
// the contract emitter reads as the component's name, so the route module in apps/api-worker
// declares routes over these without restating one field. Path and query parameters stay with the
// routes: they are addressing, not domain shape (docs/conventions/api.md, _Where a contract shape
// lives_).

export const channelField = z.enum(COMMUNICATION_CHANNELS);
export const directionField = z.enum(COMMUNICATION_DIRECTIONS);
export const dispositionField = z.enum(COMMUNICATION_DISPOSITIONS);
export const outcomeField = z.enum(CALL_OUTCOMES);
export const spamKindField = z.enum(SPAM_KINDS);

// A MESSAGE TAKEN ON THE CALL, for one member. It becomes a task in their list, written in the same
// batch as the call, so the call and the message it left are saved together or not at all; the task
// raises the assignment notification every task does. Who received it is whoever is logging the
// call, which the row already records.
export const CallMessageRequest = z
  .object({
    forUserId: identifierField("user"),
    // The line the task shows, which the form builds from what was asked ("Call back Maria Lopez").
    title: z.string().min(1).max(MAX_TASK_TITLE_LENGTH),
    // By when, as the task's own civil date in the reader's zone; all or nothing, as on a task.
    dueOn: z.string().date().nullable().optional(),
    timeZone: z.string().min(1).max(64).nullable().optional(),
    urgent: z.boolean().optional(),
  })
  .meta({ id: "CallMessageRequest" });

export const LogCommunicationRequest = z
  .object({
    channel: channelField,
    // The draft number the panel holds (POST /api/v1/number-reservations). Where the hold is still
    // the call's day, the call is saved under exactly that number.
    numberReservation: z.string().min(1).max(100).optional(),
    direction: directionField,
    // Optional, and an UNNUMBERED matter counts: matter_number is null until a matter opens, and an
    // intake or a consultation is a real anchor a first contact usually lands on. Omit it and the
    // row lands in the unrouted queue for somebody to file.
    matterId: identifierField("matter").nullable().optional(),
    counterpartyNumber: z.string().min(1).max(MAX_COUNTERPARTY_NUMBER_LENGTH),
    counterpartyEntityId: z.string().min(1).max(64).nullable().optional(),
    // Who was ON the call. Defaults to whoever is logging it, which is the overwhelmingly common
    // case; a receptionist logging the call they transferred is the other one.
    memberUserId: identifierField("user").nullable().optional(),
    occurredAt: z.string().datetime(),
    // When the line closed, which is NOT how long the call ran. A caller left on hold occupies the
    // span without spending it, so the two are recorded separately and neither is derived from the
    // other; a length that disagrees with the span is a fact about the call, not a contradiction.
    endedAt: z.string().datetime().nullable().optional(),
    durationSeconds: z.number().int().min(0).max(MAX_CALL_DURATION_SECONDS).nullable().optional(),
    body: z.string().max(MAX_COMMUNICATION_BODY_LENGTH).nullable().optional(),
    summary: z.string().max(MAX_COMMUNICATION_SUMMARY_LENGTH).nullable().optional(),
    // The other anchor: why this belongs to no matter. Not every call a firm takes is about a case —
    // spam, a wrong number, the landlord, a prospect who never came back — and a row that can only
    // be filed onto a matter sits in the queue forever. Refused together with matterId: a row is on
    // a matter, or set aside, never both.
    disposition: dispositionField.nullable().optional(),
    // The name the caller gave, as typed. A heard name, kept apart from the Directory record above.
    callerIdName: z.string().max(MAX_CALLER_ID_NAME_LENGTH).nullable().optional(),
    // What happened on the line. A spam outcome sets the spam disposition itself; a transferred call
    // names who it went to in memberUserId; a message taken names who it is for in `message`.
    outcome: outcomeField.nullable().optional(),
    spamKind: spamKindField.nullable().optional(),
    message: CallMessageRequest.nullable().optional(),
  })
  .meta({ id: "LogCommunicationRequest" });

export const SetDispositionRequest = z
  .object({ disposition: dispositionField })
  .meta({ id: "SetCommunicationDispositionRequest" });

// A CORRECTION, not a patch of arbitrary shape: every field a member could have mistyped, each
// optional and each keeping what the row holds when it is omitted. The ANCHOR is deliberately absent
// — a matter and a disposition move a row between queues through their own acts, and a correction to
// a summary must not be able to re-file a message somebody else has just filed.
export const UpdateCommunicationRequest = z
  .object({
    channel: channelField.optional(),
    direction: directionField.optional(),
    counterpartyNumber: z.string().min(1).max(MAX_COUNTERPARTY_NUMBER_LENGTH).optional(),
    counterpartyEntityId: z.string().min(1).max(64).nullable().optional(),
    memberUserId: identifierField("user").nullable().optional(),
    occurredAt: z.string().datetime().optional(),
    endedAt: z.string().datetime().nullable().optional(),
    durationSeconds: z.number().int().min(0).max(MAX_CALL_DURATION_SECONDS).nullable().optional(),
    body: z.string().max(MAX_COMMUNICATION_BODY_LENGTH).nullable().optional(),
    summary: z.string().max(MAX_COMMUNICATION_SUMMARY_LENGTH).nullable().optional(),
  })
  .meta({ id: "UpdateCommunicationRequest" });

export const RouteCommunicationRequest = z
  .object({ matterId: identifierField("matter") })
  .meta({ id: "RouteCommunicationRequest" });

export const CommunicationDetail = z
  .object({
    id: z.string(),
    // The number the firm says out loud — the day the call happened and that day's own sequence,
    // "2026-09-08-0042". A handle is what the platform joins on; this is what a receptionist writes
    // on a message slip and reads back down a telephone. Null only on rows recorded before the
    // sequence existed and never numbered.
    referenceNumber: z.string().nullable(),
    channel: channelField,
    direction: directionField,
    // Null while the row is in the unrouted queue.
    matterId: z.string().nullable(),
    // The matter as it stands, resolved by the read rather than kept as a second copy that could
    // drift. The STATUS is not decoration: an anchor may be an intake or a consultation, and what
    // may be said to a prospect and to a client are different things, so somebody about to reply
    // needs to see which. matterNumber is null on exactly those, and the rung's own number — a
    // consultation's tentative one, an intake's — is what a surface shows in its place.
    matterTitle: z.string().nullable(),
    matterStatus: z.string().nullable(),
    matterNumber: z.string().nullable(),
    consultationNumber: z.string().nullable(),
    intakeNumber: z.string().nullable(),
    // Why the row belongs to no matter, where somebody has said so. Null on a filed row and on one
    // nobody has decided about yet — those two are told apart by matterId, not by this.
    disposition: dispositionField.nullable(),
    counterpartyNumber: z.string(),
    counterpartyEntityId: z.string().nullable(),
    memberUserId: z.string().nullable(),
    occurredAt: z.string(),
    // When the line closed. The span from occurredAt to here is how long the line was open;
    // durationSeconds is how long the call actually took. A caller on hold makes them differ, and
    // both are true.
    endedAt: z.string().nullable(),
    durationSeconds: z.number().nullable(),
    body: z.string().nullable(),
    summary: z.string().nullable(),
    // How the row came to exist. A member's recollection of a call and a carrier's report of the
    // same call carry different weight, and a surface that cannot tell them apart will present the
    // wrong one as fact.
    producer: z.enum(["member", "carrier"]),
    loggedByUserId: z.string().nullable(),
    // The name the caller gave, as typed; never a Directory record (counterpartyEntityId is that).
    callerIdName: z.string().nullable(),
    // What happened on the line, and which kind of spam where it was spam.
    outcome: outcomeField.nullable(),
    spamKind: spamKindField.nullable(),
    // The task a message taken on this call became. The message is open while that task is.
    messageTaskId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: "CommunicationDetail" });
