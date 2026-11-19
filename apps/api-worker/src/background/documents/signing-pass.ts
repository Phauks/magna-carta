import { newCorrelationId } from "@magna-carta/telemetry/ids";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { FirmId } from "@magna-carta/identifiers/types";
import { emailAdapterForEnv } from "../../auth-instance.ts";
import type { Bindings } from "../../bindings.ts";
import type { SendEmail } from "../../email-port.ts";
import type { SigningRequestId } from "@magna-carta/identifiers/types";
import { SEAL_BACKSTOP_DELAY_MILLISECONDS } from "../../signing/seal-completed.ts";
import { sealRequestForFirm } from "../../signing/sealing-wiring.ts";
import { sweepFirmSigning } from "../../signing/signing-sweep.ts";
import { listUnsealedCompleted } from "../../signing/statements.ts";
import { listReachableActiveFirms } from "../scheduled.ts";

// The hourly pass that expires signing requests past their last moment and sends the reminders a
// sender asked for (src/signing/signing-sweep.ts decides which), and seals any completed request
// the prompt sealing at completion did not reach (src/signing/seal-completed.ts). It rides the hourly trigger because
// a reminder every N days needs no finer clock, and an expiry an hour late is refused by the link's
// own instant in the meantime.
//
// A deployment with no public address has nowhere for a reminder's link to point, so the pass
// expires requests and sends nothing rather than mailing a link that cannot open.

export async function runSigningPass(
  env: Bindings,
  options: {
    readonly now?: () => Date;
    readonly send?: SendEmail;
    readonly seal?: typeof sealRequestForFirm;
  } = {},
): Promise<{ readonly expired: number; readonly reminded: number; readonly sealed: number }> {
  const seal = options.seal ?? sealRequestForFirm;
  let sealed = 0;
  const logger = createWorkersLogger(env.TELEMETRY);
  const correlationId = newCorrelationId();
  const now = (options.now ?? (() => new Date()))();
  const origin = env.APP_BASE_URL === undefined ? null : new URL(env.APP_BASE_URL).origin;
  const send = options.send ?? emailAdapterForEnv(env);
  let expired = 0;
  let reminded = 0;
  let undelivered = 0;
  for (const firm of await listReachableActiveFirms(env)) {
    try {
      const firmName = await readFirmName(env, firm.firmId);
      const result = await sweepFirmSigning({
        database: firm.database,
        firmId: firm.firmId as FirmId,
        firmName,
        mailing: {
          send,
          key: env.AUTH_SECRET,
          origin: origin ?? "",
          logger,
          correlationId,
        },
        now,
        remind: origin !== null,
      });
      expired += result.expired;
      reminded += result.reminded;
      undelivered += result.undelivered;
      const before = new Date(now.getTime() - SEAL_BACKSTOP_DELAY_MILLISECONDS).toISOString();
      for (const requestId of await listUnsealedCompleted(firm.database, before)) {
        const outcome = await seal(
          env,
          firm.firmId,
          firm.database,
          requestId as SigningRequestId,
          logger,
        );
        if (outcome.kind === "sealed") sealed += 1;
      }
    } catch (caught) {
      logOperationFailed(logger, `cron:signing:${firm.firmId}`, caught, correlationId);
    }
  }
  if (expired > 0) logger.count("signing.requests_expired", {}, expired);
  if (reminded > 0) logger.count("signing.requests_reminded", {}, reminded);
  if (undelivered > 0) logger.count("signing.reminders_undelivered", {}, undelivered);
  return { expired, reminded, sealed };
}

async function readFirmName(env: Bindings, firmId: string): Promise<string> {
  const row = await env.DB_CONTROL.prepare(
    "SELECT name, display_name FROM firm WHERE id = ? LIMIT 1",
  )
    .bind(firmId)
    .first<{ name: string; display_name: string | null }>();
  return row?.display_name ?? row?.name ?? "";
}
