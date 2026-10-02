import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { guarded } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { CommunicationId, MatterId, UserId } from "@magna-carta/identifiers/types";
import type { ObservedDraw } from "@magna-carta/sequence-numbering/bounded-retry";
import {
  planSchemeDraw,
  schemeDrawOpeningStatements,
} from "@magna-carta/sequence-numbering/scheme-draw";
import { communicationNumberDate, COMMUNICATION_NUMBERING_TABLES } from "./numbering.ts";
import {
  insertCommunicationStatement,
  readCommunication,
  readRoutableMatter,
  routeCommunicationStatement,
  setCommunicationDispositionStatement,
  unrouteCommunicationStatement,
  updateCommunicationStatement,
} from "./communication-statements.ts";
import type { CommunicationChannel, CommunicationDirection } from "./types.ts";
import {
  CommunicationValidationError,
  assertOneAnchor,
  normalizeContent,
  normalizeCounterpartyNumber,
  normalizeDisposition,
  normalizeEndedAt,
  normalizeOccurredAt,
} from "./validation.ts";

// The call and text log's write paths: log one by hand, file one onto a matter, take one back off.
//
// Nothing here reads a clock, holds a database binding, or calls anything external: the clock, the
// actor and the random source arrive as options, which is what lets a fixture mint a byte-identical
// batch.
//
// THREE PRODUCERS, ONE RECORD, and only the first is built. A member typing in a call they made from
// their own mobile writes the same row a Telnyx webhook will write later, and `producer` is what
// says which. That is the seam that lets this subsystem exist before any carrier account does —
// A2P 10DLC registration is weeks of procurement — and it is only a real seam if the carrier path
// writes through the same table and the same columns, which is why nothing here is shaped around
// the hand-logging case in particular.

export interface CommunicationServiceOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId;
  readonly randomSource?: RandomSource;
  // The same predicate the federated timeline composes. Every read on the way to a write goes
  // through it, so an id-addressed write path cannot reach a row a list read could not.
  readonly visibility: VisibleMatterPredicate;
  // Whether the actor holds communications:reviewUnrouted. A write path that reads an unrouted row
  // on its way — which filing one necessarily does — is gated by the same key as looking at it, so
  // the queue cannot be worked by id from outside the permission that reveals it.
  readonly mayReviewUnrouted: boolean;
  // What the reference-number draw observed, reported before the batch is composed so a losing
  // attempt can advance THAT counter out of band — the in-batch increment rolls back with everything
  // else. Only the logging path draws, so only it reports; the caller's bounded retry supplies this
  // (numbering.ts, and the matter draw's own arrangement in packages/matters).
  readonly observeDraw?: (draw: ObservedDraw) => void;
}

// A matter that has closed still holds every conversation already on it, and it is still readable.
// What it refuses is a NEW one being filed onto it: reopening exists, and a firm quietly accreting
// correspondence onto a closed file is how a closed file stops meaning anything.
const ROUTABLE_STATUSES: ReadonlySet<string> = new Set(["intake", "consultation", "open", "hold"]);

export interface LogCommunicationInput {
  readonly channel: CommunicationChannel;
  readonly direction: CommunicationDirection;
  // Nullable, and an unnumbered matter counts. `matter.matter_number` is null until the status
  // reaches `open`, and an intake or a consultation is a real anchor a first contact usually lands
  // on — a firm texts a prospect before the file exists. So the check below is on the matter's
  // STATUS and never on its number.
  readonly matterId?: MatterId | null;
  readonly counterpartyNumber: string;
  readonly counterpartyEntityId?: string | null;
  readonly memberUserId?: UserId | null;
  readonly occurredAt: string;
  // When the line closed. Optional, and independent of the length: a caller left on hold occupies
  // the span without spending it, so the two are separate facts and neither is derived from the
  // other (validation.ts says why at more length).
  readonly endedAt?: string | null;
  readonly durationSeconds?: number | null;
  readonly body?: string | null;
  readonly summary?: string | null;
  // Why it belongs to no matter, where whoever recorded it already knows. A wrong number is spam the
  // moment somebody writes it down, and making them file it first and set it aside second would be
  // two acts for one fact.
  readonly disposition?: string | null;
}

export async function logCommunication(
  database: SqlDatabase,
  input: LogCommunicationInput,
  options: CommunicationServiceOptions,
): Promise<{ communicationId: CommunicationId; effect: EffectWrite }> {
  const now = options.clock.now();
  const counterpartyNumber = normalizeCounterpartyNumber(input.counterpartyNumber);
  const occurredAt = normalizeOccurredAt(input.occurredAt, now);
  const endedAt = normalizeEndedAt(input.endedAt, input.channel, occurredAt);
  const content = normalizeContent(input);
  const matterId = input.matterId ?? null;
  const disposition = normalizeDisposition(input.disposition);
  assertOneAnchor(matterId, disposition);

  if (matterId !== null) {
    await assertRoutable(database, matterId, options.visibility);
  }

  // THE NUMBER THE FIRM SAYS OUT LOUD, drawn here rather than rendered from the handle: it counts
  // within the day the call happened, so it takes a counter, and the two statements that make the
  // draw safe go into the same batch as the insert. A losing draw aborts the whole batch on the
  // partial unique index over the rendered number, and the caller's bounded retry re-runs this with
  // the advanced counter (numbering.ts).
  const plan = await planSchemeDraw(database, "communication", COMMUNICATION_NUMBERING_TABLES, {
    openedDate: communicationNumberDate(occurredAt),
  });
  options.observeDraw?.({
    scopeKey: plan.scopeKey,
    observedValue: plan.observedValue,
    startValue: plan.startValue,
  });
  const referenceNumber = plan.number;

  const communicationId = newIdentifier("communication", options.randomSource);
  return {
    communicationId,
    effect: {
      statements: [
        ...schemeDrawOpeningStatements(database, COMMUNICATION_NUMBERING_TABLES, plan),
        insertCommunicationStatement(database, {
          id: communicationId,
          referenceNumber,
          channel: input.channel,
          direction: input.direction,
          matterId,
          counterpartyNumber,
          counterpartyEntityId: input.counterpartyEntityId ?? null,
          // Who was ON the call, which defaults to whoever is logging it — the overwhelmingly
          // common case is a member recording their own call — but is separable, because a
          // receptionist logging the call they just transferred is the other one.
          memberUserId: input.memberUserId ?? options.actorUserId,
          occurredAt,
          endedAt,
          durationSeconds: content.durationSeconds,
          body: content.body,
          summary: content.summary,
          disposition,
          loggedByUserId: options.actorUserId,
          now,
        }),
        domainAuditStatement(database, {
          event: "communications.communication.logged",
          subjectId: communicationId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // Identifiers, enums and instants. Never the message text, never the summary, and never
          // the counterparty's number: what was said and who it was said to are the content this
          // record exists to hold, and the audit log is a compliance record with its own retention
          // and its own readers. That a call happened on a matter at a time discloses nothing on
          // its own, which is exactly what makes it the right thing to log here.
          metadata: {
            matterId,
            disposition,
            channel: input.channel,
            direction: input.direction,
            occurredAt,
            // The number the firm quotes. An identifier rather than content, and the one thing an
            // auditor reading this row can match against a message slip on a desk.
            referenceNumber,
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// FILING one onto a matter — the act that exists only on the firm-wide screen. Inside a matter the
// matter is already known, so there is nothing to decide.
export async function routeCommunication(
  database: SqlDatabase,
  communicationId: CommunicationId,
  matterId: MatterId,
  options: CommunicationServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await readCommunication(
    database,
    communicationId,
    options.visibility,
    options.mayReviewUnrouted,
  );
  if (existing === undefined) {
    throw new CommunicationValidationError(
      "communication-unknown",
      "that is not a call or a message in this firm",
    );
  }
  if (existing.matter_id !== null) {
    throw new CommunicationValidationError(
      "communication-already-routed",
      "that is already on a matter; take it off first",
    );
  }
  await assertRoutable(database, matterId, options.visibility);

  const now = options.clock.now();
  return {
    effect: {
      statements: [
        routeCommunicationStatement(database, { id: communicationId, matterId, now }),
        domainAuditStatement(database, {
          event: "communications.communication.routed",
          subjectId: communicationId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId, channel: existing.channel, occurredAt: existing.occurred_at },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// UNFILING. The row goes back to the queue rather than being deleted: what was said still happened,
// and a message taken off the wrong matter has to land somewhere a person will see it again.
export async function unrouteCommunication(
  database: SqlDatabase,
  communicationId: CommunicationId,
  options: CommunicationServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await readCommunication(
    database,
    communicationId,
    options.visibility,
    options.mayReviewUnrouted,
  );
  if (existing === undefined) {
    throw new CommunicationValidationError(
      "communication-unknown",
      "that is not a call or a message in this firm",
    );
  }
  if (existing.matter_id === null) {
    throw new CommunicationValidationError(
      "communication-not-routed",
      "that is not on a matter already",
    );
  }

  const now = options.clock.now();
  return {
    effect: {
      statements: [
        guarded(
          unrouteCommunicationStatement(database, { id: communicationId, now }),
          "communication.unroute",
        ),
        domainAuditStatement(database, {
          event: "communications.communication.unrouted",
          subjectId: communicationId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // The matter it came OFF, which is the fact somebody asking "why is this not on the file
          // any more" needs and the only place it survives once the column is null.
          metadata: { matterId: existing.matter_id, occurredAt: existing.occurred_at },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// SETTING ONE ASIDE — the other way a row leaves the queue, and the reason the queue can be emptied
// at all. A wrong number, the landlord, a prospect who never came back: none of them can be filed
// onto a matter, because there is no matter. Passing null takes the row back off its disposition and
// returns it to the queue, which is what happens when a firm decides a call it had written off is
// real work after all.
export async function setCommunicationDisposition(
  database: SqlDatabase,
  communicationId: CommunicationId,
  disposition: string | null,
  options: CommunicationServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const wanted = normalizeDisposition(disposition);
  const existing = await readExisting(database, communicationId, options);
  // A row on a matter is not also set aside. Taking it off the matter is a separate, deliberate act
  // with its own audit event, and folding it in here would let a firm lose a filing by mistake.
  if (existing.matter_id !== null) {
    throw new CommunicationValidationError(
      "communication-already-routed",
      "that is on a matter; take it off first",
    );
  }
  if (wanted === null && existing.disposition === null) {
    throw new CommunicationValidationError(
      "communication-not-set-aside",
      "that is not set aside already",
    );
  }

  const now = options.clock.now();
  return {
    effect: {
      statements: [
        guarded(
          setCommunicationDispositionStatement(database, {
            id: communicationId,
            disposition: wanted,
            now,
          }),
          "communication.disposition",
        ),
        domainAuditStatement(database, {
          event:
            wanted === null
              ? "communications.communication.returnedToQueue"
              : "communications.communication.setAside",
          subjectId: communicationId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // The reason it was set aside, and the one it carried before. Both are enums, and the
          // second is the fact somebody asking "why is this back in the queue" needs — it is the
          // only place it survives once the column is null.
          metadata: {
            disposition: wanted,
            previousDisposition: existing.disposition,
            occurredAt: existing.occurred_at,
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// CORRECTING ONE. A hand-logged call is somebody's recollection typed at speed, so it is wrong
// sometimes — a digit in the number, the wrong direction, a length in the wrong units — and a log
// that cannot be corrected is a log people stop trusting rather than one that stays accurate.
//
// EVERY FIELD IS RESOLVED, NOT PATCHED. An omitted field keeps what the row holds; the whole row is
// then re-validated as if it were being logged fresh, because the channel decides which content
// fields may be filled and a partial write could land a channel change without the content change
// that has to accompany it.
//
// THE ANCHOR IS NOT CHANGEABLE HERE. A matter and a disposition move a row between queues, each
// through its own concurrency-safe act; a correction to a summary must not be able to silently
// re-file a message somebody else has just filed.
export interface UpdateCommunicationInput {
  readonly channel?: CommunicationChannel;
  readonly direction?: CommunicationDirection;
  readonly counterpartyNumber?: string;
  readonly counterpartyEntityId?: string | null;
  readonly memberUserId?: UserId | null;
  readonly occurredAt?: string;
  readonly endedAt?: string | null;
  readonly durationSeconds?: number | null;
  readonly body?: string | null;
  readonly summary?: string | null;
}

export async function updateCommunication(
  database: SqlDatabase,
  communicationId: CommunicationId,
  input: UpdateCommunicationInput,
  options: CommunicationServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await readExisting(database, communicationId, options);
  // A CARRIER ROW IS NOT A DRAFT. It is what the network reported, and a member editing it would
  // turn an observation into a recollection wearing an observation's badge — which is the one thing
  // the `producer` column exists to prevent.
  if (existing.producer !== "member") {
    throw new CommunicationValidationError(
      "communication-not-editable",
      "that record came from the carrier and is not a member's to change",
    );
  }

  const now = options.clock.now();
  const channel = input.channel ?? existing.channel;
  const counterpartyNumber = normalizeCounterpartyNumber(
    input.counterpartyNumber ?? existing.counterparty_number,
  );
  const occurredAt = normalizeOccurredAt(input.occurredAt ?? existing.occurred_at, now);
  const endedAt = normalizeEndedAt(
    input.endedAt === undefined ? existing.ended_at : input.endedAt,
    channel,
    occurredAt,
  );
  const content = normalizeContent({
    channel,
    body: input.body === undefined ? existing.body : input.body,
    summary: input.summary === undefined ? existing.summary : input.summary,
    durationSeconds:
      input.durationSeconds === undefined ? existing.duration_seconds : input.durationSeconds,
  });

  return {
    effect: {
      statements: [
        updateCommunicationStatement(database, {
          id: communicationId,
          channel,
          direction: input.direction ?? existing.direction,
          counterpartyNumber,
          counterpartyEntityId:
            input.counterpartyEntityId === undefined
              ? existing.counterparty_entity_id
              : input.counterpartyEntityId,
          memberUserId:
            input.memberUserId === undefined ? existing.member_user_id : input.memberUserId,
          occurredAt,
          endedAt,
          durationSeconds: content.durationSeconds,
          body: content.body,
          summary: content.summary,
          now,
        }),
        domainAuditStatement(database, {
          event: "communications.communication.corrected",
          subjectId: communicationId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // Enums and instants only, on the logging event's terms: what was said and who it was said
          // to are the content this record exists to hold, and the audit log has its own readers.
          metadata: {
            channel,
            direction: input.direction ?? existing.direction,
            occurredAt,
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// The row, through the same gate a list read goes through — so an id-addressed write can never reach
// one a list could not. Raised as the same refusal whether the row is absent or merely unreachable:
// telling the two apart would make every write path an existence oracle.
async function readExisting(
  database: SqlDatabase,
  communicationId: CommunicationId,
  options: CommunicationServiceOptions,
) {
  const existing = await readCommunication(
    database,
    communicationId,
    options.visibility,
    options.mayReviewUnrouted,
  );
  if (existing === undefined) {
    throw new CommunicationValidationError(
      "communication-unknown",
      "that is not a call or a message in this firm",
    );
  }
  return existing;
}

// The anchor check, in one place because both write paths need exactly the same one.
//
// A matter that does not exist and a matter the reader may not see raise the SAME refusal, and that
// is deliberate: telling them apart would make either route an existence oracle for walled matters —
// ask about an id, learn from the wording whether it is real. A CLOSED matter is its own refusal
// because it is a different problem with a different fix.
async function assertRoutable(
  database: SqlDatabase,
  matterId: MatterId,
  visibility: VisibleMatterPredicate,
): Promise<void> {
  const matter = await readRoutableMatter(database, matterId, visibility);
  if (matter === undefined) {
    throw new CommunicationValidationError(
      "communication-unknown-matter",
      "that is not a matter you can file to",
    );
  }
  if (!ROUTABLE_STATUSES.has(matter.status)) {
    throw new CommunicationValidationError(
      "communication-matter-closed",
      "that matter is closed; reopen it before filing anything to it",
    );
  }
}
