/*
 * The upload queue — the transfers this browser is running, kept where a screen change cannot
 * reach them.
 *
 * AN UPLOAD IS NOT THE DIALOG'S. The dialog is where a batch is chosen and started; once Upload is
 * pressed the batch belongs here, at module level, so the reader can close the panel, open another
 * matter, or go and record their time while the bytes keep moving. The dialog and the top-bar
 * upload tray both READ this state; neither owns it. That is the arrangement the download shelf
 * already uses for the other direction, and it is what lets "other work commence" while a long
 * batch runs.
 *
 * WHAT IS LOST IF THE TAB CLOSES, AND HOW THE READER IS TOLD. A transfer lives in this tab: the
 * files are the browser's File handles and cannot survive a reload. So while anything is in flight
 * the module holds a `beforeunload` guard and the browser asks before the tab goes. Nothing else can
 * ask that question — a dialog of our own would already be gone — so this is the one place a
 * native prompt is right. Navigation INSIDE the app never interrupts a batch and never asks.
 *
 * A BATCH REMEMBERS WHERE IT WAS GOING. Every item records the matter, the folder it landed in and
 * the file it became, so the tray can open the folder afterwards and a failed item can be sent
 * again into the same place without the reader choosing it twice.
 *
 * Three files move at once. One at a time left a hundred small files taking a hundred round trips
 * in single file; more than a few at once competes with the reader's own screen for the connection
 * and gives the host a burst it has to queue anyway.
 */
import type { DroppedEntry } from "@magna-carta/design-system/dropzone";
import { folderPathOf } from "@magna-carta/design-system/dropzone";
import { problemGuidance } from "$lib/documents/document-presentation.ts";
import { createFolder as createFolderRequest, type FolderSummary } from "./folder-api.ts";
import { disambiguated } from "./file-names.ts";
import { MatterFileIndex, fileKey } from "./file-rows.ts";
import {
  uploadIntoFolder,
  UPLOAD_STAGE_NARRATION,
  type UploadOutcome,
  type UploadRequest,
} from "./file-upload.ts";
import type { MatterFile } from "./matter-file-api.ts";
import { intakeEntryKey, type IntakeProgress, type IntakeStage } from "./upload-intake.ts";

/** How many files are sent at once. */
export const UPLOAD_CONCURRENCY = 3;

/** Everything the dialog decided, handed over once when Upload is pressed. */
export interface UploadBatchPlan {
  readonly matterId: string;
  readonly matterTitle: string;
  /** The folder the batch lands in; null is the matter's Home. */
  readonly destinationFolderId: string | null;
  /** The destination folder as the reader would name it: "Discovery / 2024", or "Home". */
  readonly destinationLabel: string;
  readonly entries: readonly DroppedEntry[];
  readonly createdAtBasis: "upload" | "source";
  readonly documentTypeId: string | null;
  /** The destination matter's folders and files as last read, for landing folders and names. */
  readonly folders: readonly FolderSummary[];
  readonly files: readonly MatterFile[];
}

export interface UploadBatchItem {
  /** The intake key — the same key the dialog's table rows carry. */
  readonly key: string;
  readonly entry: DroppedEntry;
  /** What the row is called: its path when it came from a folder, else its name. */
  readonly name: string;
  stage: IntakeStage;
  reason?: string;
  /** The file it became, once reserved. */
  fileId?: string;
}

/** The seams the runner uses, injectable so the queue is tested without a network. */
export interface UploadQueueDependencies {
  readonly fetchImpl: typeof fetch;
  readonly upload: (request: UploadRequest) => Promise<UploadOutcome>;
  readonly createFolder: (
    input: { matterId: string; parentFolderId: string | null; name: string },
    idempotencyKey: string,
  ) => Promise<
    { kind: "ok"; value: { folderId: string } } | { kind: "problem" } | { kind: "transport" }
  >;
  readonly now: () => string;
  readonly newIdentifier: () => string;
}

function realDependencies(): UploadQueueDependencies {
  return {
    fetchImpl: fetch,
    upload: uploadIntoFolder,
    createFolder: (input, idempotencyKey) => createFolderRequest(fetch, input, idempotencyKey),
    now: () => new Date().toISOString(),
    newIdentifier: () => crypto.randomUUID(),
  };
}

/** The failure line carries the stage and the Error ID, because a report needs both. */
export function uploadFailureReason(outcome: UploadOutcome): string {
  if (outcome.kind === "problem") {
    const where = UPLOAD_STAGE_NARRATION[outcome.stage].toLowerCase();
    const errorId = outcome.problem.errorId;
    return (
      problemGuidance(outcome.problem).message +
      ` (failed while ${where}` +
      (errorId === undefined ? ")" : `; Error ID ${errorId})`)
    );
  }
  if (outcome.kind === "transport") {
    return `Nothing answered while ${UPLOAD_STAGE_NARRATION[outcome.stage].toLowerCase()}.`;
  }
  return "";
}

let nextBatchNumber = 1;

export class UploadBatch {
  readonly id: string;
  readonly matterId: string;
  readonly matterTitle: string;
  readonly destinationFolderId: string | null;
  readonly destinationLabel: string;
  readonly createdAtBasis: "upload" | "source";
  readonly documentTypeId: string | null;
  readonly startedAt: string;
  items = $state<UploadBatchItem[]>([]);
  finishedAt = $state<string | null>(null);

  /**
   * The folders this batch has made or found, by intake path, as the PROMISE of each — so three
   * files arriving at once in a folder that does not exist yet wait on one creation rather than
   * each making their own. Shared across the batch's retries.
   */
  readonly landedFolders = new Map<string, Promise<{ id: string | null } | undefined>>();
  /** The destination's folders and files as read when the batch began. */
  index: MatterFileIndex;
  readonly #dependencies: UploadQueueDependencies;

  constructor(plan: UploadBatchPlan, dependencies: UploadQueueDependencies) {
    this.id = `upload-batch-${String(nextBatchNumber)}`;
    nextBatchNumber += 1;
    this.matterId = plan.matterId;
    this.matterTitle = plan.matterTitle;
    this.destinationFolderId = plan.destinationFolderId;
    this.destinationLabel = plan.destinationLabel;
    this.createdAtBasis = plan.createdAtBasis;
    this.documentTypeId = plan.documentTypeId;
    this.startedAt = dependencies.now();
    this.index = new MatterFileIndex(plan.folders, plan.files);
    this.#dependencies = dependencies;
    this.items = plan.entries.map((entry) => ({
      key: intakeEntryKey(entry),
      entry,
      name: entry.relativePath === "" ? entry.file.name : entry.relativePath,
      stage: "chosen" as const,
    }));
    this.landedFolders.set("", Promise.resolve({ id: plan.destinationFolderId }));
  }

  get total(): number {
    return this.items.length;
  }
  get uploaded(): number {
    return this.items.filter((item) => item.stage === "settled").length;
  }
  get failed(): number {
    return this.items.filter((item) => item.stage === "failed").length;
  }
  get inFlight(): number {
    return this.items.filter(
      (item) => item.stage !== "chosen" && item.stage !== "settled" && item.stage !== "failed",
    ).length;
  }
  get running(): boolean {
    return this.finishedAt === null;
  }

  /** Each item's standing, keyed the way the intake table keys its rows. */
  get progress(): ReadonlyMap<string, IntakeProgress> {
    return new Map(
      this.items.map((item) => [
        item.key,
        item.reason === undefined
          ? { stage: item.stage }
          : { stage: item.stage, reason: item.reason },
      ]),
    );
  }

  /**
   * The folder an entry lands in, made if it does not exist yet. Folders are matched by name under
   * their parent — a second upload of the same folder lands in the one already there rather than
   * beside it — and each level is made once per batch, however many files sit inside it.
   * Undefined means a level could not be made, and the entry does not go.
   */
  landingFolder(folderPath: string): Promise<{ id: string | null } | undefined> {
    const known = this.landedFolders.get(folderPath);
    if (known !== undefined) return known;
    const landing = this.#makeLandingFolder(folderPath);
    this.landedFolders.set(folderPath, landing);
    return landing;
  }

  async #makeLandingFolder(folderPath: string): Promise<{ id: string | null } | undefined> {
    const cut = folderPath.lastIndexOf("/");
    const parent = await this.landingFolder(cut === -1 ? "" : folderPath.slice(0, cut));
    if (parent === undefined) return undefined;
    const name = cut === -1 ? folderPath : folderPath.slice(cut + 1);
    const existing = this.index
      .childrenOf(parent.id)
      .find((folder) => folder.name.localeCompare(name, undefined, { sensitivity: "base" }) === 0);
    if (existing !== undefined) return { id: existing.id };
    const made = await this.#dependencies.createFolder(
      { matterId: this.matterId, parentFolderId: parent.id, name },
      this.#dependencies.newIdentifier(),
    );
    if (made.kind !== "ok") {
      // Forgotten rather than remembered as a failure, so a retry may try the folder again.
      this.landedFolders.delete(folderPath);
      return undefined;
    }
    // The made folder joins the index so a later level, and a later retry, find it by name.
    this.index = new MatterFileIndex(
      [...this.index.folders, { id: made.value.folderId, parentFolderId: parent.id, name }],
      this.index.documents,
    );
    return { id: made.value.folderId };
  }

  /** The names already taken in each landing folder, so a collision files as a copy. */
  readonly #takenIn = new Map<string | null, { key: string; name: string }[]>();

  async send(item: UploadBatchItem): Promise<void> {
    const landing = await this.landingFolder(folderPathOf(item.entry));
    if (landing === undefined) {
      item.stage = "failed";
      item.reason = `The folder ${folderPathOf(item.entry)} could not be made, so this file was not sent.`;
      return;
    }
    let taken = this.#takenIn.get(landing.id);
    if (taken === undefined) {
      taken = this.index
        .filesIn(landing.id)
        .map((file) => ({ key: fileKey(file.id), name: file.name }));
      this.#takenIn.set(landing.id, taken);
    }
    const filedAs = disambiguated(item.entry.file.name, taken);
    taken.push({ key: `pending:${filedAs}`, name: filedAs });
    item.stage = "reserving";
    delete item.reason;
    const outcome = await this.#dependencies.upload({
      fetchImpl: this.#dependencies.fetchImpl,
      matterId: this.matterId,
      folderId: landing.id,
      file: item.entry.file,
      name: filedAs,
      documentTypeId: this.documentTypeId,
      createdAtBasis: this.createdAtBasis,
      onStage: (stage) => {
        item.stage = stage;
      },
    });
    if (outcome.kind === "problem" || outcome.kind === "transport") {
      item.stage = "failed";
      item.reason = uploadFailureReason(outcome);
      return;
    }
    item.fileId = outcome.fileId;
    item.stage = "settled";
  }

  /** Run every item that has not gone yet, a few at a time, and mark the batch finished after. */
  async run(): Promise<void> {
    this.finishedAt = null;
    const pending = this.items.filter((item) => item.stage === "chosen" || item.stage === "failed");
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const item = pending[next];
        next += 1;
        if (item === undefined) return;
        await this.send(item);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(UPLOAD_CONCURRENCY, pending.length) }, () => worker()),
    );
    this.finishedAt = this.#dependencies.now();
    noteBatchFinished(this);
  }
}

// ---- the module's state --------------------------------------------------------------------------

let batches = $state<UploadBatch[]>([]);
/** Bumped per matter when a batch touching it finishes, so a file list open on it re-reads. */
let revisions = $state<Record<string, number>>({});

/** Every batch this browser has started and not yet cleared, newest first. */
export function uploadBatches(): readonly UploadBatch[] {
  return batches;
}

/** How many batches are still moving bytes. */
export function runningUploadBatches(): readonly UploadBatch[] {
  return batches.filter((batch) => batch.running);
}

export function uploadsInFlight(): boolean {
  return batches.some((batch) => batch.running);
}

/** The count a file list keys its reload on: changes whenever a batch on that matter finishes. */
export function matterUploadRevision(matterId: string): number {
  return revisions[matterId] ?? 0;
}

function noteBatchFinished(batch: UploadBatch): void {
  revisions = { ...revisions, [batch.matterId]: (revisions[batch.matterId] ?? 0) + 1 };
  releaseUnloadGuardIfIdle();
}

/**
 * Start a batch. Returns at once with the batch, whose items report as they go; the transfer runs
 * on its own and outlives whatever surface asked for it.
 */
export function startUploadBatch(
  plan: UploadBatchPlan,
  dependencies: UploadQueueDependencies = realDependencies(),
): UploadBatch {
  const batch = new UploadBatch(plan, dependencies);
  batches = [batch, ...batches];
  holdUnloadGuard();
  void batch.run();
  return batch;
}

/** Send a batch's failed items again, into the same places. */
export function retryFailedUploads(batch: UploadBatch): void {
  if (batch.running || batch.failed === 0) return;
  holdUnloadGuard();
  void batch.run();
}

/** Clear a finished batch from the list. A running one stays: it is still happening. */
export function dismissUploadBatch(batch: UploadBatch): void {
  if (batch.running) return;
  batches = batches.filter((candidate) => candidate !== batch);
}

/** Clear every finished batch. */
export function dismissFinishedUploads(): void {
  batches = batches.filter((batch) => batch.running);
}

// ---- the tab-close guard -------------------------------------------------------------------------

function askBeforeUnload(event: BeforeUnloadEvent): void {
  if (!uploadsInFlight()) return;
  event.preventDefault();
  // Older engines read a string off the event; modern ones show their own words either way.
  event.returnValue = "";
}

let guardHeld = false;

function holdUnloadGuard(): void {
  if (guardHeld || typeof window === "undefined") return;
  window.addEventListener("beforeunload", askBeforeUnload);
  guardHeld = true;
}

function releaseUnloadGuardIfIdle(): void {
  if (!guardHeld || uploadsInFlight() || typeof window === "undefined") return;
  window.removeEventListener("beforeunload", askBeforeUnload);
  guardHeld = false;
}

/** For tests: forget every batch. */
export function resetUploadQueueForTests(): void {
  batches = [];
  revisions = {};
  releaseUnloadGuardIfIdle();
}
