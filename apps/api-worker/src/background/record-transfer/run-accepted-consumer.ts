import { recordRecheckRequests } from "@magna-carta/conflicts/recheck-request";
import { readConflictsRecheckSettings } from "@magna-carta/conflicts/recheck-settings";
import { selectLiveMattersLinkedByRunStatement } from "@magna-carta/record-transfer/source-record-link-statements";
import {
  TRANSFER_RUN_ACCEPTED_TOPIC,
  type TransferRunAcceptedPayload,
} from "@magna-carta/record-transfer/transfer-requests";
import type { Logger } from "@magna-carta/telemetry/logger";
import type { Bindings } from "../../bindings.ts";
import type { ProxyBatchDatabase } from "../../firm-database/firm-database-proxy.ts";

// The queue's side of accepting a record transfer run. While a run's matters were arriving nothing
// asked for a conflicts check of them: several thousand arriving in an afternoon must not each ask.
// Accepting the run is the moment they become the firm's matters, and this asks for the checks.
//
// It records one request per live matter the run brought in and runs no check itself. The conflicts
// ledger puts as many on the queue as one event may and leaves the rest to its own scheduled sweep,
// so a run of any size is recorded whole and checked at the pace the firm's settings allow.
//
// Any number of deliveries is safe: the ledger keeps one open request per matter and cause, and the
// cause here is the run. A closed matter is not asked about, which is the conflicts check's own
// rule; its parties are still found by other matters' checks.
export async function consumeTransferRunAccepted(
  _env: Bindings,
  firmDatabase: ProxyBatchDatabase,
  message: { readonly payload: string; readonly causeOccurredAt?: string },
  logger: Logger,
): Promise<void> {
  const payload = JSON.parse(message.payload) as Partial<TransferRunAcceptedPayload>;
  if (typeof payload.transferRunId !== "string") return;
  const { results } = await selectLiveMattersLinkedByRunStatement(
    firmDatabase,
    payload.transferRunId,
  ).all<{ id: string }>();
  if (results.length === 0) return;
  const now = () => new Date().toISOString();
  const settings = await readConflictsRecheckSettings(firmDatabase);
  const recorded = await recordRecheckRequests(
    firmDatabase,
    {
      causeTopic: TRANSFER_RUN_ACCEPTED_TOPIC,
      causeReference: payload.transferRunId,
      causeOccurredAt: message.causeOccurredAt ?? now(),
      matterIds: results.map((row) => row.id),
      maxMattersPerEvent: settings.maxMattersPerEvent,
    },
    { now },
  );
  logger.count(
    "conflicts.recheck.requested",
    { topic: TRANSFER_RUN_ACCEPTED_TOPIC },
    recorded.mattersAffected,
  );
}
