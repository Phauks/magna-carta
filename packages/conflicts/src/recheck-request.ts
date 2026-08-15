import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import { insertRecheckRequestStatement } from "./recheck-statements.ts";
import { CONFLICTS_RECHECK_REQUESTED_TOPIC } from "./topics.ts";

// RECORDING THAT A RE-CHECK IS OWED — the write half of the request path.
//
// This module never runs a check and never imports one. Request and run are separate on purpose: a
// slow check must not be able to back-pressure the recording of causes, because the recording is the
// part that makes staleness visible, and a firm can act on "a re-check is pending" long before the
// check itself lands.
//
// Two bounds, and only one of them touches rows:
//
//   * EVERY affected matter gets a ledger row. Always. A cap on rows would be a cause the platform
//     noticed and then forgot, which is the failure this whole ledger exists to make impossible.
//   * The number of matters taken onto the QUEUE in one go is capped. Rows beyond the cap simply
//     wait for the cron backstop, which drains oldest cause first. Falling behind is then a visible
//     state rather than a silent gap.

// How many statements one D1 batch carries. A large fan-out — a new firm member reaching every open
// matter — is written in chunks rather than as one enormous batch, so the write stays predictable.
const LEDGER_WRITE_CHUNK = 50;

export interface RecordRecheckRequestsInput {
  readonly causeTopic: string;
  // The handle the cause is about. Never a value.
  readonly causeReference: string;
  readonly causeOccurredAt: string;
  readonly matterIds: readonly string[];
  readonly maxMattersPerEvent: number;
}

export interface RecordRecheckRequestsResult {
  // How many matters the cause reached. Rows may be fewer where a request for the same cause was
  // already open — the partial unique index collapses a redelivery into a no-op.
  readonly mattersAffected: number;
  // How many of them were also put on the queue for an immediate drain.
  readonly mattersQueued: number;
}

export async function recordRecheckRequests(
  database: BatchDatabase,
  input: RecordRecheckRequestsInput,
  options: { readonly now: () => string; readonly randomSource?: RandomSource },
): Promise<RecordRecheckRequestsResult> {
  if (input.matterIds.length === 0 || input.causeReference.length === 0) {
    return { mattersAffected: 0, mattersQueued: 0 };
  }

  const requestedAt = options.now();
  // Deterministic order, so which matters ride the queue and which wait for the backstop is a
  // property of the data rather than of whatever order a query happened to return.
  const matterIds = [...new Set(input.matterIds)].toSorted((left, right) =>
    left.localeCompare(right),
  );
  const queued = new Set(matterIds.slice(0, Math.max(1, input.maxMattersPerEvent)));

  for (let offset = 0; offset < matterIds.length; offset += LEDGER_WRITE_CHUNK) {
    const chunk = matterIds.slice(offset, offset + LEDGER_WRITE_CHUNK);
    await commitEffectBatch(
      database,
      {
        statements: chunk.map((matterId) =>
          insertRecheckRequestStatement(database, {
            id: newIdentifier("conflictsRecheckRequest", options.randomSource),
            matterId,
            causeTopic: input.causeTopic,
            causeReference: input.causeReference,
            causeOccurredAt: input.causeOccurredAt,
            requestedAt,
          }),
        ),
        // The drain signal rides the SAME commit as the rows it is about, so the message exists if
        // and only if those rows do. It names the matter and nothing else: the run consumer re-reads
        // the matter's open set when it gets there, so a message that arrives late, twice, or after
        // the backstop already drained the matter resolves to the truth in the table.
        outboxMessages: chunk
          .filter((matterId) => queued.has(matterId))
          .map((matterId) => ({
            topic: CONFLICTS_RECHECK_REQUESTED_TOPIC,
            payload: { matterId },
          })),
      },
      { now: () => requestedAt },
    );
  }

  return { mattersAffected: matterIds.length, mattersQueued: queued.size };
}
