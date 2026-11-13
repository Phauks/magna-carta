/*
 * The two ways a document comes into a matter, and the one way it gains a new version — the
 * multi-step ceremonies, out of the components so they are unit-testable against a fake fetch.
 *
 * Both ceremonies are asynchronous on the server by design: the bytes go to object storage without
 * passing through the Worker, and what decides whether they are servable (the magic-byte gate, the
 * hash, the malware scan) runs on a queue afterwards. So neither finishes when its HTTP call
 * returns — each ends in a poll, and each reports its stages so a person watching sees which step
 * is running rather than a spinner that means nothing.
 */
import {
  completeUpload,
  initiateUpload,
  abortUpload,
  putUploadBytes,
  readAssemblyStatus,
  readUploadStatus,
  submitAssembly,
  type ApiOutcome,
  type Problem,
  type AssemblyOutputFormat,
  type AssemblyStatus,
} from "./document-api.ts";

/** Where a ceremony has got to, for the surface to narrate. */
export type CreationStage =
  | "reserving"
  | "uploading"
  | "committing"
  | "assembling"
  | "scanning"
  | "settled";

export type CreationOutcome =
  /** The bytes cleared the gate: the document is on the matter and readable. */
  | { kind: "created"; fileId: string; versionId: string | null }
  /** The gate refused the bytes. The document is on the matter and says so; it has no content. */
  | { kind: "rejected"; fileId: string; reason: string | null }
  /**
   * Everything the caller controls succeeded, but the outcome had not landed before the wait ran
   * out. The document exists; the list will show what it settled as on the next read.
   */
  | { kind: "still-settling"; fileId: string }
  | { kind: "problem"; problem: Problem; stage: CreationStage }
  | { kind: "transport"; stage: CreationStage };

export interface CeremonyOptions {
  readonly fetchImpl: typeof fetch;
  /** Called as each stage begins, so the surface can say what is happening. */
  readonly onStage?: (stage: CreationStage) => void;
  /** Injected in tests so a poll does not spend real seconds. */
  readonly sleep?: (milliseconds: number) => Promise<void>;
  /** Injected in tests; the browser's own generator otherwise. */
  readonly newIdempotencyKey?: () => string;
}

// The gate runs on a queue: fast for a small document, not instant. Twenty attempts a second and a
// half apart is a thirty-second ceiling — long enough for a scan under local emulation, short enough
// that a person is not left staring. Running out is NOT a failure; it is reported as its own outcome.
const POLL_ATTEMPTS = 20;
const POLL_INTERVAL_MS = 1_500;

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function defaultIdempotencyKey(): string {
  return crypto.randomUUID();
}

/**
 * Bring a document into a matter from bytes the person chose — or, with `fileId`, bring those bytes
 * in as the NEXT VERSION of a document that is already there. It is one ceremony because it is one
 * on the server: the only difference is whether the reservation names an existing document.
 *
 * The four steps are the contract's, in order: reserve a pending version and get a signed URL, PUT
 * the bytes straight to object storage, tell the host the bytes are there, then wait for the gate.
 * The signed headers are passed through untouched — they carry the object's dimensions, and bytes
 * written without them land somewhere nothing can place.
 */
export async function uploadDocument(
  options: CeremonyOptions & {
    readonly matterId: string;
    readonly file: File;
    readonly fileId?: string;
    /** The folder a new document is filed in. Ignored for a new version, which stays where it is. */
    readonly folderId?: string | null;
  },
): Promise<CreationOutcome> {
  const {
    fetchImpl,
    matterId,
    file,
    fileId,
    folderId,
    onStage,
    sleep = defaultSleep,
    newIdempotencyKey = defaultIdempotencyKey,
  } = options;

  onStage?.("reserving");
  const initiated = await initiateUpload(
    fetchImpl,
    {
      matterId,
      name: file.name,
      declaredSize: file.size,
      // An empty type is what a browser reports for a file it does not recognise. The host sniffs
      // the bytes itself and refuses a declared type that disagrees with them, so sending an honest
      // "unknown" is safer than guessing one from the extension.
      declaredContentType: file.type === "" ? null : file.type,
      ...(fileId === undefined ? {} : { fileId }),
      ...(fileId === undefined && folderId !== undefined ? { folderId } : {}),
    },
    newIdempotencyKey(),
  );
  if (initiated.kind !== "ok") return atStage(initiated, "reserving");

  const reservation = initiated.value;
  if (reservation.mode !== "put" || reservation.url === undefined) {
    // A document over the firm's mode threshold reserves a resumable multipart session instead. That
    // ceremony signs and tracks every part, which this surface does not do — so it says so plainly
    // rather than half-running it. The pending version the reservation minted is given back first,
    // so the refusal leaves no half-made document behind.
    await abortUpload(fetchImpl, reservation.uploadId);
    return {
      kind: "problem",
      stage: "reserving",
      problem: {
        status: 413,
        detail:
          "This document is large enough that it needs the resumable upload, which this screen " +
          "does not run yet. Choose a smaller document.",
      },
    };
  }

  onStage?.("uploading");
  const put = await putUploadBytes(fetchImpl, reservation.url, reservation.headers ?? {}, file);
  if (put.kind !== "ok") {
    // The reservation already put a pending version on the matter; bytes that never landed must not
    // leave it there as a document with nothing behind it. Best-effort: the failure being reported
    // is the one that matters, and the stale-pending sweep catches what this cannot reach.
    await abortUpload(fetchImpl, reservation.uploadId);
    return atStage(put, "uploading");
  }

  onStage?.("committing");
  const completed = await completeUpload(fetchImpl, reservation.uploadId, newIdempotencyKey());
  if (completed.kind !== "ok") {
    await abortUpload(fetchImpl, reservation.uploadId);
    return atStage(completed, "committing");
  }

  onStage?.("scanning");
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const status = await readUploadStatus(fetchImpl, reservation.uploadId);
    if (status.kind !== "ok") return atStage(status, "scanning");
    if (status.value.versionStatus === "clean") {
      onStage?.("settled");
      return { kind: "created", fileId: reservation.fileId, versionId: reservation.versionId };
    }
    if (status.value.versionStatus === "quarantined") {
      onStage?.("settled");
      return {
        kind: "rejected",
        fileId: reservation.fileId,
        reason: status.value.quarantineReason,
      };
    }
    if (status.value.versionStatus === "abandoned") {
      // The host discarded this version deliberately — the commonest cause is bytes identical to the
      // document's current version, which is one logical version, not two. The document is intact.
      onStage?.("settled");
      return { kind: "created", fileId: reservation.fileId, versionId: null };
    }
    await sleep(POLL_INTERVAL_MS);
  }
  onStage?.("settled");
  return { kind: "still-settling", fileId: reservation.fileId };
}

export interface AssemblyOutcome {
  readonly creation: CreationOutcome;
  /**
   * The merge fields the matter could not supply, and the Word merge fields the template still
   * carries. Both are surfaced: a document that completed with blanks in it, or one printing text
   * left over from the template, reads as finished and is not.
   */
  readonly absentFieldKeys: readonly string[];
  readonly frozenMergeFieldNames: readonly string[];
  /**
   * What the job produced. A `pdf` outcome is the one the platform seal accepts, so this is what a
   * surface reads to decide whether "send this for signature" is something it may offer at all.
   */
  readonly outputFormat: AssemblyOutputFormat;
}

/**
 * Build a document from one of the firm's templates and file it onto the matter. The merge itself —
 * reading the template package, resolving the matter's values, writing the OOXML — runs off the
 * request path, so this submits and polls. The produced document enters the matter through the same
 * upload and scan path every other document does, which is why the result is a document identifier
 * and not bytes.
 */
export async function assembleDocument(
  options: CeremonyOptions & {
    readonly matterId: string;
    readonly templateVersionId: string;
    /**
     * What to file. `pdf` has the host convert the merged document before filing it, in the same
     * job — it is not a second step this surface runs, and it is not something a person does to the
     * document afterwards. Defaults to the word-processing document.
     */
    readonly outputFormat?: AssemblyOutputFormat;
  },
): Promise<AssemblyOutcome> {
  const {
    fetchImpl,
    matterId,
    templateVersionId,
    outputFormat = "docx",
    onStage,
    sleep = defaultSleep,
    newIdempotencyKey = defaultIdempotencyKey,
  } = options;

  onStage?.("reserving");
  const submitted = await submitAssembly(
    fetchImpl,
    matterId,
    templateVersionId,
    outputFormat,
    newIdempotencyKey(),
  );
  if (submitted.kind !== "ok") return bareAssembly(atStage(submitted, "reserving"), outputFormat);

  onStage?.("assembling");
  let last: AssemblyStatus | undefined;
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const status = await readAssemblyStatus(fetchImpl, matterId, submitted.value.assemblyId);
    if (status.kind !== "ok") return bareAssembly(atStage(status, "assembling"), outputFormat);
    last = status.value;

    if (last.status === "failed") {
      return {
        creation: {
          kind: "problem",
          stage: "assembling",
          problem: {
            status: 422,
            detail: last.reason ?? "The assembly did not complete.",
          },
        },
        absentFieldKeys: last.absentFieldKeys,
        frozenMergeFieldNames: last.frozenMergeFieldNames,
        outputFormat: last.outputFormat,
      };
    }
    if (last.status === "done") {
      onStage?.("settled");
      return {
        creation:
          last.fileId === null
            ? { kind: "problem", stage: "assembling", problem: { status: 500 } }
            : { kind: "created", fileId: last.fileId, versionId: last.fileVersionId },
        absentFieldKeys: last.absentFieldKeys,
        frozenMergeFieldNames: last.frozenMergeFieldNames,
        outputFormat: last.outputFormat,
      };
    }
    await sleep(POLL_INTERVAL_MS);
  }

  onStage?.("settled");
  return {
    creation:
      last?.fileId == null
        ? { kind: "transport", stage: "assembling" }
        : { kind: "still-settling", fileId: last.fileId },
    absentFieldKeys: last?.absentFieldKeys ?? [],
    frozenMergeFieldNames: last?.frozenMergeFieldNames ?? [],
    outputFormat: last?.outputFormat ?? outputFormat,
  };
}

function atStage(outcome: ApiOutcome<unknown>, stage: CreationStage): CreationOutcome {
  if (outcome.kind === "problem") return { kind: "problem", problem: outcome.problem, stage };
  return { kind: "transport", stage };
}

function bareAssembly(
  creation: CreationOutcome,
  outputFormat: AssemblyOutputFormat,
): AssemblyOutcome {
  return { creation, absentFieldKeys: [], frozenMergeFieldNames: [], outputFormat };
}
