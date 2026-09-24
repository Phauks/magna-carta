import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import {
  CHECKOUT_STALE_GRACE_HOURS,
  checkoutIdleHoursDefinition,
  IDLE_CHECKOUT_SWEEP_BATCH,
  markCheckoutStaleStatement,
  releaseStaleCheckoutStatement,
  selectIdleActiveCheckouts,
  selectReleasableStaleCheckouts,
} from "@magna-carta/file-manager/checkout-statements";
import { setFileEditStateStatement } from "@magna-carta/file-manager/file-statements";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../../bindings.ts";
import { listReachableActiveFirms } from "../scheduled.ts";

// The idle-checkout auto-release sweep (daily, alongside reconciliation/tiering). A checkout left idle
// past the firm's window is moved to 'stale' with a grace; a stale checkout past its grace is released.
// Releasing an exclusive lock frees the document (edit_state -> idle); an offline working copy never
// held the editing posture, so its release leaves edit_state untouched. Two stages give a holder who
// returns during the grace a chance to resume before the checkout is reclaimed.

const HOUR_MS = 60 * 60 * 1000;

export interface IdleCheckoutReport {
  readonly firmsProcessed: number;
  readonly marked: number;
  readonly released: number;
}

export interface IdleCheckoutOptions {
  readonly now?: number; // injected wall clock (epoch ms) for deterministic cutoffs; defaults to now
}

export async function runIdleCheckoutSweep(
  env: Bindings,
  options: IdleCheckoutOptions = {},
): Promise<IdleCheckoutReport> {
  const logger = createWorkersLogger(env.TELEMETRY);
  const correlationId = newCorrelationId();
  const nowMs = options.now ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const firms = await listReachableActiveFirms(env);
  let firmsProcessed = 0;
  let marked = 0;
  let released = 0;
  for (const firm of firms) {
    try {
      const idleHours = await readFirmSetting(firm.database, checkoutIdleHoursDefinition);
      const idleCutoffIso = new Date(nowMs - idleHours * HOUR_MS).toISOString();
      const releaseAtIso = new Date(nowMs + CHECKOUT_STALE_GRACE_HOURS * HOUR_MS).toISOString();

      // Stage 1: idle active checkouts -> stale, scheduling their release after the grace.
      const idle = await selectIdleActiveCheckouts(
        firm.database,
        idleCutoffIso,
        IDLE_CHECKOUT_SWEEP_BATCH,
      );
      if (idle.length > 0) {
        await commitEffectBatch(
          firm.database,
          {
            statements: idle.map((checkout) =>
              markCheckoutStaleStatement(firm.database, checkout.id, releaseAtIso),
            ),
            outboxMessages: [],
          },
          { now: () => nowIso },
        );
        marked += idle.length;
      }

      // Stage 2: stale checkouts past their grace -> released. An exclusive lock release also frees the
      // document (edit_state -> idle); an offline working copy never set the posture.
      const releasable = await selectReleasableStaleCheckouts(
        firm.database,
        nowIso,
        IDLE_CHECKOUT_SWEEP_BATCH,
      );
      if (releasable.length > 0) {
        const statements = releasable.flatMap((checkout) => [
          releaseStaleCheckoutStatement(firm.database, checkout.id),
          ...(checkout.lockType === "exclusive"
            ? [setFileEditStateStatement(firm.database, checkout.fileId, "idle", nowIso)]
            : []),
        ]);
        await commitEffectBatch(
          firm.database,
          { statements, outboxMessages: [] },
          { now: () => nowIso },
        );
        released += releasable.length;
      }
      firmsProcessed++;
    } catch (caught) {
      // One firm's failure must not starve the rest; logged through the one pipeline, next pass retries.
      logOperationFailed(logger, `cron:idle-checkout-sweep:${firm.firmId}`, caught, correlationId);
    }
  }
  return { firmsProcessed, marked, released };
}
