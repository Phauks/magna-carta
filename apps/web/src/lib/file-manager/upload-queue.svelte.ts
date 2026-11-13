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
import { collidingSibling, disambiguated } from "./file-names.ts";
import { MatterFileIndex, fileKey, formatBytes } from "./file-rows.ts";
import {
  uploadIntoFolder,
  UPLOAD_STAGE_NARRATION,
  type UploadOutcome,
  type UploadRequest,
} from "./file-upload.ts";
import type { MatterFile } from "./matter-file-api.ts";
import { digestOf } from "./upload-digests.svelte.ts";
import { paceOf, paceText, withSample, type Pace, type PaceSample } from "./upload-pace.ts";
import {
  intakeEntryKey,
  isPreSendStage,
  sentBytesOf,
  type IntakeProgress,
  type IntakeStage,
  type NameClashChoice,
} from "./upload-intake.ts";
import {
  rememberFinishedUpload,
  type UploadHistoryFile,
  type UploadHistoryOutcome,
} from "$lib/transfers/upload-history.svelte.ts";

/** How many files are sent at once. */
export const UPLOAD_CONCURRENCY = 3;
/** How often a running batch samples its bytes for the rate and the time remaining. */
const PACE_SAMPLE_MILLISECONDS = 500;

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
  /**
   * The document type each file carries, by intake key. A batch is not one classification: a
   * folder of discovery holds correspondence, pleadings and exhibits together, and asking the
   * reader to send it three times to say so is the question the batch-wide control put to them.
   * A key the map does not name carries no type, which is the default.
   */
  readonly documentTypeIds: ReadonlyMap<string, string | null>;
  /**
   * Where each file stood when Upload was pressed — read, held, still being read — keyed the way
   * the table keys its rows. The batch starts every item from exactly this, so the Status column
   * does not lurch back to "Chosen" at the press and forward again as each lane reaches its file.
   * Absent, every item starts as chosen.
   */
  readonly readiness?: ReadonlyMap<string, IntakeProgress>;
  /**
   * What to do with a file whose name is already taken in the folder it lands in: the batch-wide
   * answer, and any file the reader answered for on its own. A file with no clash asks nothing.
   */
  readonly nameClashDefault: NameClashChoice;
  readonly nameClashChoices: ReadonlyMap<string, NameClashChoice>;
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
  /** Why it failed, in full: the fault, the stage it happened at, the Error ID. */
  reason?: string;
  /** What failed, in one short line: the server's problem detail, or the transport's class. */
  failure?: string;
  /** Bytes the browser has sent so far, while the file is being sent. */
  sentBytes: number;
  /** Bytes read so far, while the file is being hashed to ask whether the firm holds it. */
  hashedBytes: number;
  /** The file it became, once reserved — or the file the matter already held. */
  fileId?: string;
  /** The digest, once read; kept across retries so the file is read once. */
  sha256?: string | null;
}

/** The seams the runner uses, injectable so the queue is tested without a network. */
export interface UploadQueueDependencies {
  readonly fetchImpl: typeof fetch;
  readonly upload: (request: UploadRequest) => Promise<UploadOutcome>;
  /**
   * The file's SHA-256, or null when it could not be read, in which case it is sent without the
   * firm being asked. The read has usually STARTED already — the register begins reading when a
   * file is chosen — so this reports from wherever the read has got to and the signal stops the
   * watching, not the read. The matter is what the firm is asked against.
   */
  readonly digest: (
    entry: DroppedEntry,
    options: {
      onProgress: (readBytes: number) => void;
      signal: AbortSignal;
      matterId: string;
    },
  ) => Promise<string | null>;
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
    digest: (entry, options) => digestOf(entry, options),
    createFolder: (input, idempotencyKey) => createFolderRequest(fetch, input, idempotencyKey),
    now: () => new Date().toISOString(),
    newIdentifier: () => crypto.randomUUID(),
  };
}

/*
 * WHY THE BYTE WRITE GETS A LINE OF ITS OWN.
 *
 * Every step of an upload but one goes to the app's own host, where a failure comes back as a
 * problem with an Error ID and the host's log holds the other half of the story. The byte write
 * does not: the browser writes STRAIGHT to the firm's object storage on a signed URL, so a refusal
 * there reaches neither the app nor its log, and a browser reports every one of them the same way
 * — no status, no body, nothing to read. The shape it leaves behind is a reservation, no bytes,
 * and an abort a few seconds later; that ladder of retries is what the seconds are.
 *
 * So the line says where the fault is rather than only that there was one. It is the storage that
 * did not answer, not the app — which is provable from the reservation that had just succeeded —
 * and the ordinary cause is a bucket that does not allow this site to write to it, which no amount
 * of retrying by the reader will change. Saying "nothing answered" there sent readers to look at
 * their connection for a fault that is not on their side of it.
 */
const STORAGE_UNREACHABLE =
  "Couldn't reach the firm's storage, so this file wasn't uploaded and nothing was saved. Try " +
  "again. If it keeps failing, an administrator can run the upload check in the Database section " +
  "of the version menu, top right.";

/** The short line for a byte write that got no answer: the class of fault, and where it sits. */
const STORAGE_UNREACHABLE_NATURE = "Couldn't reach the firm's storage";

/**
 * What a failed upload says about itself, in two lengths. `failure` is the NATURE of the fault in
 * one line, for the row and the tray to show without being pointed at: the server's own problem
 * detail where it gave one (its title where it gave only that), or the class of transport fault
 * where nothing answered. `reason` is the whole account — the fault, the stage it happened at and
 * the Error ID — for the hover and the report to support.
 */
export interface UploadFailure {
  readonly failure: string;
  readonly reason: string;
}

export function uploadFailure(outcome: UploadOutcome): UploadFailure {
  if (outcome.kind === "problem") {
    const where = UPLOAD_STAGE_NARRATION[outcome.stage].toLowerCase();
    const errorId = outcome.problem.errorId;
    const guidance = problemGuidance(outcome.problem);
    // The guidance's message is the server's own detail wherever it gave one, and the platform's
    // reading of the status where it did not — the one place that decision is made.
    return {
      failure: guidance.message,
      reason:
        guidance.message +
        ` (failed while ${where}` +
        (errorId === undefined ? ")" : `; Error ID ${errorId})`),
    };
  }
  if (outcome.kind === "transport") {
    if (outcome.stage === "uploading") {
      return { failure: STORAGE_UNREACHABLE_NATURE, reason: STORAGE_UNREACHABLE };
    }
    const where = UPLOAD_STAGE_NARRATION[outcome.stage].toLowerCase();
    return {
      failure: `Couldn't connect while ${where}`,
      reason: `Couldn't connect while ${where}.`,
    };
  }
  return { failure: "", reason: "" };
}

/** The failure line carries the stage and the Error ID, because a report needs both. */
export function uploadFailureReason(outcome: UploadOutcome): string {
  return uploadFailure(outcome).reason;
}

let nextBatchNumber = 1;

export class UploadBatch {
  readonly id: string;
  readonly matterId: string;
  readonly matterTitle: string;
  readonly destinationFolderId: string | null;
  readonly destinationLabel: string;
  readonly createdAtBasis: "upload" | "source";
  readonly documentTypeIds: ReadonlyMap<string, string | null>;
  readonly nameClashDefault: NameClashChoice;
  readonly nameClashChoices: ReadonlyMap<string, NameClashChoice>;
  readonly startedAt: string;
  items = $state<UploadBatchItem[]>([]);
  finishedAt = $state<string | null>(null);
  /** Raised when the reader cancels: no further item starts, and the ones in flight are abandoned. */
  cancelled = $state(false);
  /** The signal every write in this batch listens to; replaced on a retry so a cancel is one-shot. */
  #abort = new AbortController();

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
    this.documentTypeIds = new Map(plan.documentTypeIds);
    this.nameClashDefault = plan.nameClashDefault;
    this.nameClashChoices = new Map(plan.nameClashChoices);
    this.startedAt = dependencies.now();
    this.index = new MatterFileIndex(plan.folders, plan.files);
    this.#dependencies = dependencies;
    this.items = plan.entries.map((entry) => {
      const key = intakeEntryKey(entry);
      // Each item starts where the dialog last showed it. Only a pre-send stage can carry over:
      // whatever a file did in an earlier batch is that batch's, not this one's.
      const known = plan.readiness?.get(key);
      const stage = known !== undefined && isPreSendStage(known.stage) ? known.stage : "chosen";
      return {
        key,
        entry,
        name: entry.relativePath === "" ? entry.file.name : entry.relativePath,
        stage,
        sentBytes: 0,
        hashedBytes: stage === "hashing" ? (known?.hashedBytes ?? 0) : 0,
      };
    });
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
  /** Files the reader left out because their names were taken: nothing was sent or made. */
  get skipped(): number {
    return this.items.filter((item) => item.stage === "skipped").length;
  }
  get inFlight(): number {
    return this.items.filter(
      (item) =>
        !isPreSendStage(item.stage) &&
        item.stage !== "settled" &&
        item.stage !== "skipped" &&
        item.stage !== "failed" &&
        item.stage !== "cancelled",
    ).length;
  }
  get running(): boolean {
    return this.finishedAt === null;
  }
  /** Every byte the batch was asked to send. */
  get totalBytes(): number {
    return this.items.reduce((sum, item) => sum + item.entry.file.size, 0);
  }
  /** Every byte that has gone: a settled file in full, a sending file as far as it has got. */
  get sentBytes(): number {
    return this.items.reduce((sum, item) => sum + sentBytesOf(item.entry.file.size, item), 0);
  }

  /**
   * How fast the bytes are leaving and how long is left, read off samples the run takes every half
   * second. Both stand still between runs; a finished batch keeps its last reading.
   */
  pace = $state<Pace>({ bytesPerSecond: null, secondsRemaining: null });
  #samples: PaceSample[] = [];

  #samplePace(): void {
    // The rate is over bytes that crossed the wire: a skipped file counts as done for the bar and
    // the remainder, but it moved nothing and must not read as a burst of speed.
    const moved = this.items.reduce(
      (sum, item) =>
        item.stage === "skipped" ? sum : sum + sentBytesOf(item.entry.file.size, item),
      0,
    );
    const sample = { at: Date.now(), bytes: moved };
    // The window opens with the first byte. Before it, the batch is making folders and reserving,
    // and a rate of nothing over that time is not a stall, it is not yet a transfer.
    this.#samples = moved === 0 ? [sample] : withSample(this.#samples, sample);
    this.pace = paceOf(this.#samples, Math.max(0, this.totalBytes - this.sentBytes));
  }

  /** Each item's standing, keyed the way the intake table keys its rows. */
  get progress(): ReadonlyMap<string, IntakeProgress> {
    return new Map(
      this.items.map((item) => [
        item.key,
        {
          stage: item.stage,
          sentBytes: item.sentBytes,
          hashedBytes: item.hashedBytes,
          ...(item.reason === undefined ? {} : { reason: item.reason }),
          ...(item.failure === undefined ? {} : { failure: item.failure }),
        },
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

  /**
   * The names taken in each landing folder: what the matter held when the batch started, plus what
   * the batch itself has filed there. A clash with a file the MATTER holds is the reader's to
   * decide; a clash with a sibling in the same batch only ever files as a numbered copy.
   */
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
    // The reader's answer to a taken name, where the matter already holds one. Decided before the
    // digest is read, so a skipped file costs no read at all.
    const clash = collidingSibling(
      item.entry.file.name,
      this.index.filesIn(landing.id).map((file) => ({ key: fileKey(file.id), name: file.name })),
    );
    const choice =
      clash === null ? null : (this.nameClashChoices.get(item.key) ?? this.nameClashDefault);
    if (choice === "skip") {
      item.stage = "skipped";
      item.reason = `Skipped: the folder already holds ${clash ?? item.entry.file.name}, and you chose not to send this one.`;
      return;
    }
    const versionOf =
      choice === "new-version" && clash !== null
        ? this.index.filesIn(landing.id).find((file) => file.name === clash)
        : undefined;
    const filedAs =
      versionOf === undefined ? disambiguated(item.entry.file.name, taken) : versionOf.name;
    /*
     * The digest, which the register began reading when the file was CHOSEN. Usually it is already
     * answered by the time this lane reaches the file and this is one microtask; where it is not,
     * the lane waits and the row reports the read from wherever it has got to. Either way the file
     * is read once per tab, so a retry asks the same question with the same answer. It is ALWAYS
     * read: a file the firm already holds is never sent again, and there is no setting that says
     * otherwise.
     */
    item.sentBytes = 0;
    delete item.reason;
    delete item.failure;
    if (item.sha256 === undefined) {
      // A read the register has already answered resolves in a microtask, so a file that stood
      // ready never paints as reading; one still in flight reports from where it has got to.
      item.stage = "hashing";
      item.sha256 = await this.#dependencies.digest(item.entry, {
        signal: this.#abort.signal,
        matterId: this.matterId,
        onProgress: (readBytes) => {
          item.hashedBytes = readBytes;
        },
      });
    }
    if (this.cancelled) {
      item.stage = "cancelled";
      return;
    }
    const outcome = await this.#dependencies.upload({
      fetchImpl: this.#dependencies.fetchImpl,
      matterId: this.matterId,
      folderId: landing.id,
      file: item.entry.file,
      name: filedAs,
      ...(versionOf === undefined ? {} : { fileId: versionOf.id }),
      documentTypeId: this.documentTypeIds.get(item.key) ?? null,
      createdAtBasis: this.createdAtBasis,
      // A new version of a held file is not asked about: the host's own hash check at ingest
      // already answers whether the bytes changed.
      sha256: versionOf === undefined ? item.sha256 : null,
      signal: this.#abort.signal,
      onStage: (stage) => {
        item.stage = stage;
      },
      onProgress: (sentBytes) => {
        item.sentBytes = sentBytes;
      },
    });
    if (outcome.kind === "cancelled") {
      item.stage = "cancelled";
      item.sentBytes = 0;
      return;
    }
    if (outcome.kind === "problem" || outcome.kind === "transport") {
      const failed = uploadFailure(outcome);
      item.stage = "failed";
      item.sentBytes = 0;
      item.reason = failed.reason;
      item.failure = failed.failure;
      return;
    }
    if (versionOf === undefined) taken.push({ key: `pending:${filedAs}`, name: filedAs });
    item.fileId = outcome.fileId;
    if (outcome.kind === "committed" && outcome.copiedFrom !== undefined) {
      item.reason =
        outcome.copiedFrom === "matter"
          ? "Made from a copy this matter already held. Nothing was sent."
          : "Made from a copy the firm already held on another matter. Nothing was sent.";
    } else if (versionOf !== undefined) {
      item.reason = `Filed as a new version of ${versionOf.name}.`;
    }
    // The bytes landed and the check is still running past the time the dialog waits. Said, rather
    // than shown as a finished upload the matter does not list yet: a member who reads "Uploaded"
    // and finds no file thinks something was lost, when it is a scan engine warming up.
    if (outcome.kind === "settling") {
      item.reason =
        "Uploaded. The safety check is still running, and the file appears on the matter when it finishes, usually within a minute.";
    }
    item.stage = "settled";
  }

  /**
   * Run every item that has not gone yet, a few at a time, and mark the batch finished after. A
   * cancelled batch stops taking items: what is in flight is abandoned through the signal, and what
   * had not started reads "Not sent".
   */
  async run(): Promise<void> {
    this.finishedAt = null;
    this.cancelled = false;
    this.#abort = new AbortController();
    const pending = this.items.filter(
      (item) => isPreSendStage(item.stage) || item.stage === "failed" || item.stage === "cancelled",
    );
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const item = pending[next];
        next += 1;
        if (item === undefined) return;
        if (this.cancelled) {
          item.stage = "cancelled";
          continue;
        }
        await this.send(item);
      }
    };
    this.#samples = [];
    this.#samplePace();
    const sampler = setInterval(() => this.#samplePace(), PACE_SAMPLE_MILLISECONDS);
    try {
      await Promise.all(
        Array.from({ length: Math.min(UPLOAD_CONCURRENCY, pending.length) }, () => worker()),
      );
    } finally {
      clearInterval(sampler);
    }
    this.#samplePace();
    this.finishedAt = this.#dependencies.now();
    noteBatchFinished(this);
  }

  /** Stop: nothing further starts, and whatever is being sent is abandoned and given back. */
  cancel(): void {
    if (!this.running) return;
    this.cancelled = true;
    this.#abort.abort();
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

/*
 * How a finished item reads in the history. A stage that is neither settled, failed nor skipped at
 * the moment a batch finishes is an item the run never reached — a cancel, in practice — and
 * "not sent" is the honest word for it rather than the internal stage name.
 */
function historyOutcome(stage: IntakeStage): UploadHistoryOutcome {
  if (stage === "settled") return "landed";
  if (stage === "failed") return "failed";
  if (stage === "skipped") return "skipped";
  return "not-sent";
}

function historyFiles(batch: UploadBatch): UploadHistoryFile[] {
  return batch.items.map((item) => ({
    name: item.name,
    byteSize: item.entry.file.size,
    outcome: historyOutcome(item.stage),
    fileId: item.fileId ?? null,
  }));
}

function noteBatchFinished(batch: UploadBatch): void {
  revisions = { ...revisions, [batch.matterId]: (revisions[batch.matterId] ?? 0) + 1 };
  // The batch is over, so what it DID outlives the tab it did it in. Only the record is kept —
  // names, sizes, how each file ended, and the file each landed one became; never the bytes, which
  // are on the matter and are what a re-download goes and fetches.
  rememberFinishedUpload({
    id: batch.id,
    matterId: batch.matterId,
    matterTitle: batch.matterTitle,
    destinationFolderId: batch.destinationFolderId,
    destinationLabel: batch.destinationLabel,
    startedAt: batch.startedAt,
    finishedAt: batch.finishedAt ?? new Date().toISOString(),
    files: historyFiles(batch),
  });
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

/**
 * The batch's standing in one line, the same line wherever it is read: the panel above its table,
 * the tray, the Uploads page. Counts first, then, while it runs, the bytes and the pace.
 */
export function batchTallyText(batch: UploadBatch): string {
  const pace = batchPaceText(batch);
  return pace === "" ? batchCountsText(batch) : `${batchCountsText(batch)} · ${pace}`;
}

/** The counts alone: "3 of 6 uploaded · 1 skipped · 2 failed". Short enough for a header. */
export function batchCountsText(batch: UploadBatch): string {
  const parts = [`${String(batch.uploaded)} of ${String(batch.total)} uploaded`];
  if (batch.skipped > 0) parts.push(`${String(batch.skipped)} skipped`);
  if (batch.failed > 0) parts.push(`${String(batch.failed)} failed`);
  const unsent = unsentCount(batch);
  if (unsent > 0) parts.push(`${String(unsent)} not sent`);
  return parts.join(" · ");
}

/**
 * The bytes and the pace while the batch runs: "1.2 GB of 4.5 GB · 2.4 MB/s · about 20 min left".
 * Empty once it has finished. Read beside the bar, where a header line would cut it short.
 */
export function batchPaceText(batch: UploadBatch): string {
  if (!batch.running) return "";
  const pace = paceText(batch.pace);
  const bytes = `${formatBytes(batch.sentBytes)} of ${formatBytes(batch.totalBytes)}`;
  return pace === "" ? bytes : `${bytes} · ${pace}`;
}

/** How many of a batch's files were left unsent by a cancel. */
export function unsentCount(batch: UploadBatch): number {
  return batch.items.filter((item) => item.stage === "cancelled").length;
}

/** Send a batch's failed and unsent items again, into the same places. */
export function retryFailedUploads(batch: UploadBatch): void {
  if (batch.running || (batch.failed === 0 && unsentCount(batch) === 0)) return;
  holdUnloadGuard();
  void batch.run();
}

/** Stop a running batch. Files already uploaded stay; the rest are given back or never start. */
export function cancelUploadBatch(batch: UploadBatch): void {
  batch.cancel();
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
