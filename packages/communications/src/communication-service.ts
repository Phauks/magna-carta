import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { CommunicationId, MatterId, UserId } from "@magna-carta/identifiers/types";
import {
  insertCommunicationStatement,
  readCommunication,
  readRoutableMatter,
  routeCommunicationStatement,
  unrouteCommunicationStatement,
} from "./communication-statements.ts";
import type { CommunicationChannel, CommunicationDirection } from "./types.ts";
import {
  CommunicationValidationError,
  normalizeContent,
  normalizeCounterpartyNumber,
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
  readonly durationSeconds?: number | null;
  readonly body?: string | null;
  readonly summary?: string | null;
}

export async function logCommunication(
  database: SqlDatabase,
  input: LogCommunicationInput,
  options: CommunicationServiceOptions,
): Promise<{ communicationId: CommunicationId; effect: EffectWrite }> {
  const now = options.clock.now();
  const counterpartyNumber = normalizeCounterpartyNumber(input.counterpartyNumber);
  const occurredAt = normalizeOccurredAt(input.occurredAt, now);
  const content = normalizeContent(input);
  const matterId = input.matterId ?? null;

  if (matterId !== null) {
    await assertRoutable(database, matterId, options.visibility);
  }

  const communicationId = newIdentifier("communication", options.randomSource);
  return {
    communicationId,
    effect: {
      statements: [
        insertCommunicationStatement(database, {
          id: communicationId,
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
          durationSeconds: content.durationSeconds,
          body: content.body,
          summary: content.summary,
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
            channel: input.channel,
            direction: input.direction,
            occurredAt,
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
        unrouteCommunicationStatement(database, { id: communicationId, now }),
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
