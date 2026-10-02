import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import { FactsValidationError } from "./facts-grammar.ts";
import { jobCompletionDedupeKey, materializeNotification } from "./materialize.ts";
import { createNotificationPolicyReader } from "./preferences.ts";
import { resolveNotificationRecipients } from "./recipients.ts";
import { notificationTypesForJobCompletionPoint } from "./registry.ts";
import { insertNotificationStatements } from "./statements.ts";
import { inAppSuppressionEffects, type InAppSuppressionCount } from "./suppression-statements.ts";

// THE ROW FOR THE TAB THAT WAS CLOSED.
//
// A long job already pushes its terminal state to whoever is watching, over the job's own socket.
// That is unchanged and stays the fast path. What it cannot do is reach somebody who started an
// assembly, closed the tab, and went to a hearing — and "the thing you asked for is ready" is
// precisely the case where the person is not watching, because the job is long enough that watching
// it would be silly.
//
// So a terminal transition additionally writes a durable row. Three things that shape the code:
//
//   * IT REACHES ONE PERSON, and that is correct here and nowhere else in this subsystem. A job
//     notification is a reply to a request; the requester is the only person who asked. Every other
//     audience in the registry is deliberately wider, and the fitness tests hold them there.
//   * A COORDINATOR HAS NO BATCH TO RIDE. Its state lives in Durable Object storage, not in the
//     firm's database, so there is no atomic write to attach an outbox row to. The write here is
//     therefore its own, and it is best-effort by construction — which is why the caller treats a
//     failure as a counted annoyance and never as a reason to fail the job.
//   * THE DEDUPE KEY CARRIES THE OUTCOME. A job that timed out and then reported success has
//     genuinely reported two terminal states, and both are true things that happened. Keying on the
//     subject alone would leave the first one standing and tell the member their assembly failed
//     when the document is filed.

export interface JobCompletionInput {
  readonly database: BatchDatabase;
  // The emission point naming which coordinator finished. Resolves to a registry type; an
  // unrecognized one writes nothing, the same way an unrecognized topic on the bus does.
  readonly emissionPoint: string;
  readonly subjectId: string;
  readonly matterId: string | null;
  // The member who asked for the job. Null where the coordinator recorded nobody, in which case
  // there is no reply to send and nothing is written.
  readonly requestedByUserId: UserId | null;
  // The terminal facts, in the shape the registry type's `buildFacts` reads.
  readonly payload: Readonly<Record<string, unknown>>;
  // WHICH terminal state, as a short closed label, and it is part of the dedupe key rather than only
  // part of the facts. See the note above: a job that timed out and then succeeded reported two
  // terminal states, both of which happened, and only the key can let the second one through.
  readonly terminalOutcome: string;
  readonly now: string;
  readonly randomSource?: RandomSource;
}

export interface JobCompletionResult {
  readonly materializedEvents: number;
  readonly recipientRows: number;
  readonly refusedFacts: number;
  // The requester silenced the jobs category. Recorded rather than dropped: "the thing you asked
  // for is ready" not arriving is the single most likely thing a member reports as broken, and the
  // tally is what lets somebody answer it without guessing.
  readonly suppressedInApp: readonly InAppSuppressionCount[];
}

const NOTHING_WRITTEN: JobCompletionResult = {
  materializedEvents: 0,
  recipientRows: 0,
  refusedFacts: 0,
  suppressedInApp: [],
};

export async function recordJobCompletionNotification(
  input: JobCompletionInput,
): Promise<JobCompletionResult> {
  if (input.requestedByUserId === null) return NOTHING_WRITTEN;
  const types = notificationTypesForJobCompletionPoint(input.emissionPoint);
  if (types.length === 0) return NOTHING_WRITTEN;

  let materializedEvents = 0;
  let recipientRows = 0;
  let refusedFacts = 0;
  const suppressedInApp: InAppSuppressionCount[] = [];
  const policy = createNotificationPolicyReader(input.database);

  for (const type of types) {
    if (type.matterAnchored && input.matterId === null) continue;

    // Through the same resolver every other audience goes through, rather than assuming the
    // requester. The type declares `actor` and `includeActor`, so "the requester hears it" is a
    // registry fact a fitness test can read, not a special case buried in this function.
    const audience = await resolveNotificationRecipients(type, {
      database: input.database,
      matterId: input.matterId,
      actorUserId: input.requestedByUserId,
      // A job names no recipient of its own; its audience is the requester, through `actor`.
      namedRecipientUserId: null,
      namedMemberUserIds: [],
      now: () => input.now,
      policy,
    });

    const suppression = inAppSuppressionEffects(input.database, {
      category: type.category,
      suppressed: audience.suppressed,
      now: input.now,
    });
    suppressedInApp.push(...suppression.counts);

    if (audience.recipientUserIds.length === 0) {
      if (suppression.statements.length > 0)
        await commitEffectBatch(
          input.database,
          { statements: suppression.statements, outboxMessages: [] },
          { now: () => new Date().toISOString() },
        );
      continue;
    }

    let materialization;
    try {
      materialization = materializeNotification({
        type,
        payload: input.payload,
        subjectId: input.subjectId,
        matterId: input.matterId,
        recipientUserIds: audience.recipientUserIds,
        dedupeKey: jobCompletionDedupeKey(type.key, input.subjectId, input.terminalOutcome),
        occurredAt: input.now,
        createdAt: input.now,
        randomSource: input.randomSource,
      });
    } catch (caught) {
      if (caught instanceof FactsValidationError) {
        refusedFacts++;
        continue;
      }
      throw caught;
    }

    await input.database.batch([
      ...insertNotificationStatements(input.database, materialization),
      ...suppression.statements,
    ]);
    materializedEvents++;
    recipientRows += materialization.recipients.length;
  }

  return { materializedEvents, recipientRows, refusedFacts, suppressedInApp };
}
