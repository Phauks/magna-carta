import { readConflictsRecheckSettings } from "@magna-carta/conflicts/recheck-settings";
import { resolveAffectedMatters } from "@magna-carta/conflicts/recheck-cause";
import { recordRecheckRequests } from "@magna-carta/conflicts/recheck-request";
import type { Logger } from "@magna-carta/telemetry/logger";
import type { ProxyBatchDatabase } from "../../firm-database/firm-database-proxy.ts";

// THE REQUEST CONSUMER: a corpus change arrives, the matters it could have changed the answer for are
// resolved, and one ledger row per matter is recorded. That is all it does.
//
// It must NOT import runConflictsCheck, and it must not import the disposition module. Request and
// run are separate consumers so that a slow check cannot back-pressure the recording of causes — the
// recording is what makes staleness visible, and it has to keep up with the write path even when the
// checks themselves are running behind. A source-scan fitness function fails the build if either
// import appears here.
//
// Every terminal outcome returns normally so the message acks. A payload that will not parse, or a
// topic that resolves to no matters, can never become processable by being retried; only a genuine
// transient database fault propagates, and that is the one case where a redelivery buys something.

// The outbox row's payload as it crosses the per-firm bus: canonical JSON delivered as a string.
function parsePayload(payload: string): Readonly<Record<string, unknown>> | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Readonly<Record<string, unknown>>;
  } catch {
    return null;
  }
}

export interface RecheckRequestMessage {
  readonly topic: string;
  readonly payload: string;
  // When the cause committed — the outbox row's own creation instant, which is what makes the
  // interval a firm can point to ("noticed the merge and re-checked within four minutes") a real
  // measurement rather than a measurement of how busy the queue was.
  readonly causeOccurredAt: string;
}

export async function consumeRecheckRequest(
  firmDatabase: ProxyBatchDatabase,
  message: RecheckRequestMessage,
  logger: Logger,
): Promise<void> {
  const payload = parsePayload(message.payload);
  if (payload === null) {
    // Structurally unusable. Retrying can never make it parse; it would only march a permanent error
    // to the dead-letter queue. Ack-drop with a counter, so the drop is a number somebody can see
    // rather than a silence.
    logger.count("conflicts.recheck.malformed_cause", { topic: message.topic }, 1);
    return;
  }

  const cause = await resolveAffectedMatters(firmDatabase, message.topic, payload);
  if (cause.matterIds.length === 0) {
    // Ordinary and expected for most causes — a renamed entity nobody has a live matter with, and
    // every entity creation, resolve here. Counted rather than logged: the rate is the signal, and a
    // topic is a closed label where an entity handle would be firm data.
    logger.count("conflicts.recheck.no_affected_matters", { topic: message.topic }, 1);
    return;
  }

  const settings = await readConflictsRecheckSettings(firmDatabase);
  const result = await recordRecheckRequests(
    firmDatabase,
    {
      causeTopic: message.topic,
      causeReference: cause.causeReference,
      causeOccurredAt: message.causeOccurredAt,
      matterIds: cause.matterIds,
      maxMattersPerEvent: settings.maxMattersPerEvent,
    },
    // Non-request code reads the wall clock, the same discipline the cron sweeps and the ingest
    // consumer use off the request path.
    { now: () => new Date().toISOString() },
  );

  logger.count("conflicts.recheck.requested", { topic: message.topic }, result.mattersAffected);
  if (result.mattersQueued < result.mattersAffected) {
    // The fan-out exceeded what one relay cycle takes onto the queue. EVERY row was still written —
    // the remainder is waiting for the cron backstop, not discarded — and this counter is how a firm
    // whose events routinely outrun the queue becomes visible before the lag does.
    logger.count(
      "conflicts.recheck.fanout_deferred",
      { topic: message.topic },
      result.mattersAffected - result.mattersQueued,
    );
  }
}
