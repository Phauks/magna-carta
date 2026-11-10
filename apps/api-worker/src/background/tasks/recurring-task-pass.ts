import { GuardedWriteRefusedError, commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import {
  readScheduledRepeatingTasks,
  scheduledCopyEffects,
} from "@magna-carta/tasks/recurrence-service";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../../bindings.ts";
import { listReachableActiveFirms } from "../scheduled.ts";

// THE REPEATING-TASK PASS: for every firm, each repeating task whose next copy appears on its own
// start date gets that copy once the day has come where the task is read.
//
// HOURLY, on the digest trigger, because "its start date" is a day in the TASK'S zone and a daily
// pass at one UTC hour lands in the previous evening for half the firms on the platform. An hour is
// as late as a copy can appear; most firms' read is one indexed query that returns nothing to do.
//
// Each copy commits on its own. Its batch is guarded on the slot it fills, so a copy a completion
// already made is refused rather than made twice, and that one refusal costs no other task. One
// firm's failure is quarantined exactly as every other per-firm sweep quarantines it.
export async function runRecurringTaskPass(
  env: Bindings,
  options: { readonly now?: () => string } = {},
): Promise<number> {
  const logger = createWorkersLogger(env.TELEMETRY);
  const correlationId = newCorrelationId();
  const clock = { now: options.now ?? (() => new Date().toISOString()) };
  let written = 0;
  for (const firm of await listReachableActiveFirms(env)) {
    try {
      const tasks = await readScheduledRepeatingTasks(firm.database);
      for (const effect of await scheduledCopyEffects(firm.database, tasks, { clock })) {
        try {
          await commitEffectBatch(firm.database, effect, { now: clock.now });
          written++;
        } catch (caught) {
          // A completion made this copy between the read and the write: nothing is owed.
          if (caught instanceof GuardedWriteRefusedError) continue;
          logOperationFailed(logger, `cron:recurring-tasks:${firm.firmId}`, caught, correlationId);
        }
      }
    } catch (caught) {
      logOperationFailed(logger, `cron:recurring-tasks:${firm.firmId}`, caught, correlationId);
    }
  }
  if (written > 0) logger.count("tasks.recurring_writes", {}, written);
  return written;
}
