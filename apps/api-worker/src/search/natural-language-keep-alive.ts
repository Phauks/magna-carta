import { civilDateOf } from "@magna-carta/civil-time/civil-date";
import type { FirmId } from "@magna-carta/identifiers/types";
import { readReadyInstances } from "@magna-carta/search/natural-language-instance-statements";
import {
  usageMeterCommitStatements,
  type UsageMeterDelta,
} from "@magna-carta/search/natural-language-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { naturalLanguageInstanceOperationFailed } from "@magna-carta/telemetry/events";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../bindings.ts";
import { firmDatabaseFor } from "../firm-database/firm-database-proxy.ts";
import { resolveNaturalLanguageProvisioningPort } from "./natural-language-binding.ts";
import type { NaturalLanguageProvisioningPort } from "@magna-carta/search/natural-language-provisioning";

// THE WEEKLY KEEP-ALIVE. One trivial full-text query per ready instance.
//
// An instance that receives no search request for a month has its scheduled syncs paused. A firm
// that searches rarely would then meet a month-stale index on its next question with no warning —
// and the symptom of that is not an error, it is silently wrong answers, which is the worst failure
// this feature can have. One query a week costs a rounding error at the published full-text rate and
// removes the failure mode entirely.
//
// IT IS METERED LIKE ANY OTHER QUERY, in the full-text column, so it is never mistaken for a
// member's and never missing from a figure an invoice will contain. Hiding a query the platform
// makes on the firm's behalf would make the meter disagree with the bill.

// How many instances one pass walks. Bounded like every other sweep here; the pass pages until a
// page comes back short, and a pass that is interrupted resumes from the same ordering next week.
const KEEP_ALIVE_PAGE_SIZE = 200;

const nowInstant = () => new Date().toISOString();

function civilDay(instant: string): string {
  return civilDateOf(instant);
}

export interface KeepAliveOutcome {
  readonly attempted: number;
  readonly kept: number;
}

export async function runNaturalLanguageKeepAliveSweep(
  env: Bindings,
  port: NaturalLanguageProvisioningPort = resolveNaturalLanguageProvisioningPort(env),
  now: () => string = nowInstant,
): Promise<KeepAliveOutcome> {
  const logger = createWorkersLogger(env.TELEMETRY);
  let attempted = 0;
  let kept = 0;
  let afterFirmId: FirmId | undefined;

  for (;;) {
    const page = await readReadyInstances(env.DB_CONTROL, KEEP_ALIVE_PAGE_SIZE, afterFirmId);
    if (page.length === 0) break;
    for (const instance of page) {
      attempted += 1;
      const result = await port.keepAlive(instance.instanceName);
      if (!result.ok) {
        // Logged and stepped over. One instance the service would not answer for must not stop the
        // sweep reaching the rest — the whole value of this pass is that it covers every firm.
        logger.log(
          naturalLanguageInstanceOperationFailed(
            { correlationId: newCorrelationId(), now: now() },
            {
              operation: "keep-alive",
              reason: result.reason,
              instanceName: instance.instanceName,
            },
          ),
        );
        continue;
      }
      kept += 1;
      const delta: UsageMeterDelta = { day: civilDay(now()), fullTextQueryCount: 1 };
      const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, instance.firmId);
      await commitEffectBatch(
        firmDatabase,
        { statements: usageMeterCommitStatements(firmDatabase, delta), outboxMessages: [] },
        { now },
      );
    }
    afterFirmId = page.at(-1)?.firmId;
    if (page.length < KEEP_ALIVE_PAGE_SIZE) break;
  }

  return { attempted, kept };
}
