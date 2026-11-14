import {
  GuardedWriteRefusedError,
  commitEffectBatch,
  guarded,
} from "@magna-carta/data-access/effect-batch";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { FirmId } from "@magna-carta/identifiers/types";
import { remindSigners, SIGNING_GUARD, SigningRequestRefusal } from "./request-service.ts";
import { mailSigners, type SignerMailing } from "./signer-delivery.ts";
import {
  listOpenRequests,
  readMemberName,
  updateRequestStatusStatement,
  type SigningRequestRow,
} from "./statements.ts";

// THE CLOCK'S HALF OF A SIGNING REQUEST: what happens to a request nobody acts on.
//
// A request past its last moment is closed as expired, so the sender's tab says so and nobody is
// reminded about a document that can no longer be signed. (The signer's link already refuses it by
// the instant alone; this is what makes the record agree.) A request with reminders set mails the
// signers whose turn it is again, every so many days counted from the send or the last reminder,
// with the SAME link the first mail carried.
//
// EVERYTHING HERE IS GUARDED ON THE REQUEST STILL BEING OUT: a signer who finishes, a member who
// cancels, or a second pass between the read and the write each leave nothing for this one to do,
// and a refused guard is that outcome, not a fault.

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

/** The name a reminder the platform sent is written under on the request's activity. */
export const AUTOMATIC_REMINDER_ACTOR = "Automatic reminder";

export type SweepDecision = "expire" | "remind" | "none";

/** What the clock owes one open request now. Pure, so the schedule is tested without a database. */
export function sweepDecision(request: SigningRequestRow, now: Date): SweepDecision {
  if (request.status !== "sent") return "none";
  if (Date.parse(request.expiresAt) <= now.getTime()) return "expire";
  if (request.remindEveryDays === null || request.remindEveryDays <= 0) return "none";
  const since = request.lastRemindedAt ?? request.sentAt;
  if (since === null) return "none";
  return now.getTime() - Date.parse(since) >= request.remindEveryDays * DAY_MILLISECONDS
    ? "remind"
    : "none";
}

export interface FirmSigningSweep {
  readonly database: BatchDatabase;
  readonly firmId: FirmId;
  readonly firmName: string;
  /** Everything a mail needs but the sender's name, which is read per request. */
  readonly mailing: Omit<SignerMailing, "senderName" | "firmId" | "firmName">;
  readonly now: Date;
  /** False where reminders cannot be sent (no public address); expiry still runs. */
  readonly remind?: boolean;
}

/** One firm's open requests, expired or reminded as the clock says. Answers what it did. */
export async function sweepFirmSigning(
  sweep: FirmSigningSweep,
): Promise<{ readonly expired: number; readonly reminded: number; readonly undelivered: number }> {
  const now = sweep.now.toISOString();
  let expired = 0;
  let reminded = 0;
  let undelivered = 0;
  for (const request of await listOpenRequests(sweep.database)) {
    const decision = sweepDecision(request, sweep.now);
    if (decision === "none" || (decision === "remind" && sweep.remind === false)) continue;
    try {
      if (decision === "expire") {
        await commitEffectBatch(
          sweep.database,
          {
            statements: [
              guarded(
                updateRequestStatusStatement(sweep.database, request.id, "sent", "expired", now),
                SIGNING_GUARD.moved,
              ),
            ],
            outboxMessages: [],
          },
          { now: () => now },
        );
        expired += 1;
        continue;
      }
      const reminder = await remindSigners(sweep.database, request.id, {
        now,
        actorUserId: request.createdByUserId,
        actorName: AUTOMATIC_REMINDER_ACTOR,
      });
      await commitEffectBatch(sweep.database, reminder.effect, { now: () => now });
      reminded += 1;
      const outcome = await mailSigners(
        {
          ...sweep.mailing,
          firmId: sweep.firmId,
          firmName: sweep.firmName,
          senderName: await readMemberName(sweep.database, request.createdByUserId),
        },
        request,
        reminder.remind,
        "reminder",
      );
      undelivered += outcome.failed;
    } catch (caught) {
      if (caught instanceof GuardedWriteRefusedError || caught instanceof SigningRequestRefusal)
        continue;
      throw caught;
    }
  }
  return { expired, reminded, undelivered };
}
