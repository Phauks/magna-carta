/*
 * Adding one template to several matters at once — the runner and the model of what came of it.
 *
 * Nothing new is invented on the server for this. An assembly is a job on ONE matter, submitted
 * against that matter's own route so it carries the matter's ethical wall like every other document
 * operation; adding a template to five matters is five such jobs. What this module adds is the
 * choreography — each matter submitted with its own idempotency key, each polled to its outcome,
 * every outcome reported per matter — and the vocabulary a dialog renders that in.
 *
 * ONE MATTER'S FAILURE IS ONE MATTER'S FAILURE. A matter the member cannot assemble on, or whose
 * merge could not complete, is reported on its own row and the rest carry on; a batch that stopped
 * at the first refusal would leave a person guessing which of the others got a document.
 *
 * A DOCUMENT WITH BLANKS READS AS FINISHED AND IS NOT, so an assembly that completed with merge
 * fields the matter could not supply, or with Word merge fields the template still carries, is its
 * own standing rather than being folded into "landed": the row says the document is there AND that
 * it needs a person's eye before it goes anywhere.
 */
import { assembliesStatus, assembliesSubmit } from "@magna-carta/api-client";
import type { AssemblyStatus } from "@magna-carta/api-client";
import { failureOf } from "$lib/api/api-client.ts";
import type { Failure } from "$lib/api/problem.ts";

export type AssemblyOutputFormat = "docx" | "pdf";

/** One matter the template is being added to, as the dialog names it. */
export interface AssemblyTarget {
  readonly matterId: string;
  /** How the matter reads on its row: its number where it has one, and its title. */
  readonly label: string;
}

/** Where one matter's assembly stands. */
export type MatterAssemblyStanding =
  | { readonly kind: "waiting" }
  | { readonly kind: "submitting" }
  | { readonly kind: "assembling"; readonly assemblyId: string }
  /**
   * The document is on the matter, complete. "Landed", never "filed": in this product a document
   * is FILED with a court and nothing else may say the word (docs/conventions/design-corrections.md).
   */
  | {
      readonly kind: "landed";
      readonly fileId: string;
      readonly outputFormat: AssemblyOutputFormat;
    }
  /** The document is on the matter, and has blanks a person must look at. */
  | {
      readonly kind: "landed-with-blanks";
      readonly fileId: string;
      readonly outputFormat: AssemblyOutputFormat;
      readonly absentFieldKeys: readonly string[];
      readonly frozenMergeFieldNames: readonly string[];
    }
  /** The job ran and did not produce a document. */
  | { readonly kind: "failed"; readonly reason: string | null }
  /** A request was refused or never answered. Nothing landed. */
  | {
      readonly kind: "refused";
      readonly stage: "submitting" | "assembling";
      readonly failure: Failure;
    }
  /** The job was still running when the wait ran out. The matter's Files page shows what it settled as. */
  | { readonly kind: "still-running"; readonly assemblyId: string };

/** The two calls the runner makes, as an interface so a test answers them without a server. */
export interface AddToMattersPorts {
  submit(
    matterId: string,
    body: { templateVersionId: string; outputFormat: AssemblyOutputFormat },
    idempotencyKey: string,
  ): Promise<{ assemblyId: string }>;
  status(matterId: string, assemblyId: string): Promise<AssemblyStatus>;
  sleep(milliseconds: number): Promise<void>;
}

export interface AddToMattersRequest {
  readonly templateVersionId: string;
  readonly outputFormat: AssemblyOutputFormat;
  readonly targets: readonly AssemblyTarget[];
}

export interface AddToMattersOptions {
  readonly ports: AddToMattersPorts;
  /**
   * The idempotency key for one matter's submission. Minted per matter and per intent, and kept
   * across retries of the same intent, so a retried batch cannot file a second document on a matter
   * that already got one.
   */
  readonly keyFor: (matterId: string) => string;
  /** Called whenever a matter's standing moves, so the dialog can render each row live. */
  readonly onChange?: (matterId: string, standing: MatterAssemblyStanding) => void;
  /** How many matters are in flight at once. The rest wait their turn. */
  readonly concurrency?: number;
}

// How long one matter is waited on. A merge is seconds; a PDF conversion adds the office engine's
// start-up. Running out is NOT a failure — the job carries on and the outcome is reported as its own
// standing, because the document will still land.
const POLL_ATTEMPTS = 20;
const POLL_INTERVAL_MILLISECONDS = 1_500;
const DEFAULT_CONCURRENCY = 3;

/** What a status read says one matter's job settled as, or null while it is still running. */
export function standingFromStatus(status: AssemblyStatus): MatterAssemblyStanding | null {
  if (status.status === "failed") {
    return { kind: "failed", reason: status.reason };
  }
  if (status.status !== "done") return null;
  const fileId = status.fileId ?? "";
  if (status.absentFieldKeys.length > 0 || status.frozenMergeFieldNames.length > 0) {
    return {
      kind: "landed-with-blanks",
      fileId,
      outputFormat: status.outputFormat,
      absentFieldKeys: status.absentFieldKeys,
      frozenMergeFieldNames: status.frozenMergeFieldNames,
    };
  }
  return { kind: "landed", fileId, outputFormat: status.outputFormat };
}

async function addToOneMatter(
  target: AssemblyTarget,
  request: AddToMattersRequest,
  options: AddToMattersOptions,
): Promise<MatterAssemblyStanding> {
  const { ports, keyFor, onChange } = options;
  const report = (standing: MatterAssemblyStanding): MatterAssemblyStanding => {
    onChange?.(target.matterId, standing);
    return standing;
  };

  report({ kind: "submitting" });
  let assemblyId: string;
  try {
    const submitted = await ports.submit(
      target.matterId,
      { templateVersionId: request.templateVersionId, outputFormat: request.outputFormat },
      keyFor(target.matterId),
    );
    assemblyId = submitted.assemblyId;
  } catch (error) {
    return report({ kind: "refused", stage: "submitting", failure: failureOf(error) });
  }

  report({ kind: "assembling", assemblyId });
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    let status: AssemblyStatus;
    try {
      status = await ports.status(target.matterId, assemblyId);
    } catch (error) {
      return report({ kind: "refused", stage: "assembling", failure: failureOf(error) });
    }
    const settled = standingFromStatus(status);
    if (settled !== null) return report(settled);
    await ports.sleep(POLL_INTERVAL_MILLISECONDS);
  }
  return report({ kind: "still-running", assemblyId });
}

/**
 * Add the template to every target. Resolves once every matter has a settled standing, in the
 * targets' order, with at most `concurrency` matters in flight at a time.
 */
export async function addTemplateToMatters(
  request: AddToMattersRequest,
  options: AddToMattersOptions,
): Promise<ReadonlyMap<string, MatterAssemblyStanding>> {
  const standings = new Map<string, MatterAssemblyStanding>();
  for (const target of request.targets) {
    standings.set(target.matterId, { kind: "waiting" });
    options.onChange?.(target.matterId, { kind: "waiting" });
  }
  const queue = [...request.targets];
  const width = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const workers = Array.from({ length: Math.min(width, queue.length) }, async () => {
    for (;;) {
      const target = queue.shift();
      if (target === undefined) return;
      standings.set(target.matterId, await addToOneMatter(target, request, options));
    }
  });
  await Promise.all(workers);
  return standings;
}

/** What a batch came to, counted. */
export interface AddToMattersSummary {
  readonly landed: number;
  readonly withBlanks: number;
  readonly failed: number;
  readonly stillRunning: number;
  readonly total: number;
}

export function summarizeStandings(
  standings: ReadonlyMap<string, MatterAssemblyStanding>,
): AddToMattersSummary {
  let landed = 0;
  let withBlanks = 0;
  let failed = 0;
  let stillRunning = 0;
  for (const standing of standings.values()) {
    switch (standing.kind) {
      case "landed":
        landed += 1;
        break;
      case "landed-with-blanks":
        withBlanks += 1;
        break;
      case "failed":
      case "refused":
        failed += 1;
        break;
      case "still-running":
        stillRunning += 1;
        break;
      default:
        break;
    }
  }
  return { landed, withBlanks, failed, stillRunning, total: standings.size };
}

function matters(count: number): string {
  return `${count} matter${count === 1 ? "" : "s"}`;
}

/** The batch's outcome as one sentence, for the panel's done state. */
export function summarySentence(summary: AddToMattersSummary): string {
  const landed = summary.landed + summary.withBlanks;
  const parts: string[] = [];
  if (landed > 0) parts.push(`The document is on ${matters(landed)}`);
  if (summary.withBlanks > 0) {
    parts.push(`${summary.withBlanks} of them with blanks to look at`);
  }
  if (summary.stillRunning > 0) parts.push(`${matters(summary.stillRunning)} still being built`);
  if (summary.failed > 0) parts.push(`${matters(summary.failed)} did not get one`);
  if (parts.length === 0) return "Nothing was added.";
  return `${parts.join("; ")}.`;
}

/** How one matter's standing reads on its row. */
export function standingLine(standing: MatterAssemblyStanding): string {
  switch (standing.kind) {
    case "waiting":
      return "Waiting its turn";
    case "submitting":
      return "Submitting";
    case "assembling":
      return "Building the document";
    case "landed":
      return standing.outputFormat === "pdf"
        ? "On the matter as a PDF"
        : "On the matter as a Word document";
    case "landed-with-blanks":
      return "On the matter, with blanks to look at";
    case "failed":
      return standing.reason ?? "The document could not be built";
    case "refused":
      return (
        standing.failure.problem?.detail ??
        standing.failure.problem?.title ??
        (standing.stage === "submitting"
          ? "The request to build it was not answered"
          : "The document's progress could not be read")
      );
    case "still-running":
      return "Still being built; the matter's Files page will show it";
    default:
      return "";
  }
}

/** The lines under a row that landed with blanks — what to look for before the document goes out. */
export function blankLines(standing: MatterAssemblyStanding): readonly string[] {
  if (standing.kind !== "landed-with-blanks") return [];
  const lines: string[] = [];
  if (standing.absentFieldKeys.length > 0) {
    lines.push(`The matter could not supply: ${standing.absentFieldKeys.join(", ")}.`);
  }
  if (standing.frozenMergeFieldNames.length > 0) {
    lines.push(
      `These fields print the text last saved into the template, not a merged value: ${standing.frozenMergeFieldNames.join(", ")}.`,
    );
  }
  return lines;
}

/** True once a standing will not move again. */
export function isSettled(standing: MatterAssemblyStanding): boolean {
  return (
    standing.kind !== "waiting" && standing.kind !== "submitting" && standing.kind !== "assembling"
  );
}

/** The live ports, over the generated client. */
export function liveAddToMattersPorts(): AddToMattersPorts {
  return {
    async submit(matterId, body, idempotencyKey) {
      const { data } = await assembliesSubmit({
        path: { matterId },
        body,
        headers: { "idempotency-key": idempotencyKey },
        throwOnError: true,
      });
      return { assemblyId: data.assemblyId };
    },
    async status(matterId, assemblyId) {
      const { data } = await assembliesStatus({
        path: { matterId, assemblyId },
        throwOnError: true,
      });
      return data;
    },
    sleep(milliseconds) {
      return new Promise((resolve) => setTimeout(resolve, milliseconds));
    },
  };
}
