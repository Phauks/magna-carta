import type { ConflictsWriteOptions } from "@magna-carta/conflicts/audit";
import { executeCheckRun, type RunCheckInput } from "@magna-carta/conflicts/run-check";
import type { DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import type { ConflictsCheckId } from "@magna-carta/identifiers/types";
import type { Logger } from "@magna-carta/telemetry/logger";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import type { Bindings } from "../bindings.ts";
import { fileContentsSearcherFor } from "./file-contents-searcher.ts";

// EXECUTING A RUN A PERSON ASKED FOR, AFTER THE RESPONSE THAT OPENED IT.
//
// The route opens the run — the numbered check and the queued run row, one small batch — and
// answers 202 with the check's id and number. The search itself runs here, handed to the runtime
// through `runInBackground` so it outlives the response, and the screen polls the run row for where
// it has got to (docs/conventions/conflicts-rulings.md, R4). The engine settles the run itself:
// completed in the same batch as its record, failed with a sentence a person can act on. What this
// module adds is the one thing the engine must not do — report the failure to telemetry — and a
// shape a queue consumer could call unchanged.
//
// WHY NOT A QUEUE, TODAY. The per-firm job queue's dispatch table lives beside the cost-recovery
// consumer, and the outbox relay that feeds it is a five-minute sweep; a check a person is watching
// cannot wait for a relay cycle to start. The runtime abandons post-response work at thirty seconds,
// which every check the load profile has measured sits well inside, and a run that outlives its
// invocation is settled as failed by the next read of its check rather than left running forever.
// The durable successor is a direct send onto the queue from the route plus one entry in that
// dispatch table calling this same function; nothing about the run model changes for it.
export async function executeConflictsRunInBackground(
  context: DirectoryIdentifierContext,
  run: { readonly runId: ConflictsCheckId; readonly input: RunCheckInput },
  options: Omit<ConflictsWriteOptions, "idempotency">,
  logger: Logger,
  // The application's bindings, for reaching the file contents index when a check asks for Files.
  env?: Bindings,
): Promise<void> {
  try {
    // Inside the try: reading whether the firm indexes its files is a read of the firm's database,
    // and one that fails is this run failing, reported like any other.
    const fileContents =
      env === undefined ? undefined : await fileContentsSearcherFor(env, context.firmId);
    await executeCheckRun(
      context,
      { ...run, ...(fileContents === undefined ? {} : { fileContents }) },
      options,
    );
  } catch (error) {
    // The run row already says it failed; this is the diagnostic half, correlated by the standard
    // pipeline. The row carries no error text on purpose — a database message is not a sentence a
    // firm should find on its own conflicts record.
    logOperationFailed(logger, "conflicts.check.run", error);
  }
}
