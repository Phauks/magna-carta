/*
 * Where the workbench's files come from, in the Tools host: the ones a person just dropped.
 *
 * This is the EPHEMERAL source. A file here has no matter, no folder, no version and no record;
 * it is read and then it is gone. The same body serves a matter's files one day from a durable
 * source, and the difference between the two hosts is this module and nothing on the screen — which
 * is why the surface takes files and never a matter id.
 *
 * NOTHING IS UPLOADED ON ARRIVAL. The readings that are real the moment a file lands (what it is,
 * its digests) are computed here, in the browser, and the capabilities whose engines run in a
 * container say so rather than pretending. When the firm-scoped scratch object lands, this module
 * gains that upload and those readings move server-side; the capability modules and the screen do
 * not change, because they read outcomes rather than reaching for bytes.
 *
 * A capability the reader ASKS to run is a different question from an arrival reading: Unlock
 * sends the file to a one-shot server call only when a person presses Unlock or Recover, and
 * `WorkbenchFile.readBytes` is how it reaches the bytes to do that. Nothing here uploads on its
 * own; a capability that never runs never reads them.
 */
import { digestBuffer } from "./digest.ts";
import { IDENTIFY_PREFIX_BYTES, identifyFromPrefix } from "./identify.ts";
import {
  FILE_TYPE_CAPABILITY,
  type CapabilityOutcome,
  type PreviewState,
  type WorkbenchFile,
} from "./workbench-file.ts";
import { HASH_CAPABILITY } from "./capabilities/hash.ts";

/*
 * Above this, the digest is left to the server rather than computed here. Reading a whole file into
 * memory to hash it is fine for the working documents this surface is for and is not fine for a
 * multi-gigabyte production, and a tab that stops answering is worse than a digest that waits.
 */
const IN_BROWSER_DIGEST_LIMIT_BYTES = 64 * 1024 * 1024;

/** How much of a text file the preview shows. Enough to recognize it, not enough to render a book. */
const TEXT_PREVIEW_CHARACTERS = 4000;

/** Labels whose bytes an image decoder can render. Nothing else is drawn from these bytes. */
const PREVIEWABLE_IMAGES = new Set(["png", "jpeg", "gif", "webp", "bmp"]);

/** Labels that are text, and can therefore be shown as text rather than interpreted. */
const PREVIEWABLE_TEXT = new Set(["txt", "csv", "json", "xml", "markdown", "email"]);

function previewFor(label: string | null, prefix: Uint8Array, source: File): PreviewState {
  if (label !== null && PREVIEWABLE_IMAGES.has(label)) {
    // An object URL into an <img> hands the bytes to the image decoder and to nothing else: no
    // script runs, no markup is interpreted. That is why an image can be shown from an untrusted
    // file here while a document cannot. A document preview needs the cookieless delivery host, and
    // that host needs the file to have been uploaded, which is the seam this source does not have
    // yet.
    return { kind: "image", objectUrl: URL.createObjectURL(source) };
  }
  if (label !== null && PREVIEWABLE_TEXT.has(label)) {
    const excerpt = new TextDecoder("utf-8", { fatal: false })
      .decode(prefix)
      .slice(0, TEXT_PREVIEW_CHARACTERS);
    return { kind: "text", excerpt };
  }
  if (label === "pdf") {
    return {
      kind: "none",
      reason:
        "A document is only rendered through the cookieless delivery host, which needs the file uploaded first.",
    };
  }
  return { kind: "none", reason: "There is nothing in this kind of file to draw." };
}

async function readArrival(source: File): Promise<WorkbenchFile> {
  const prefix = new Uint8Array(await source.slice(0, IDENTIFY_PREFIX_BYTES).arrayBuffer());
  const identified = identifyFromPrefix(prefix, source.name);

  const outcomes: Record<string, CapabilityOutcome<unknown>> = {
    [FILE_TYPE_CAPABILITY]: { kind: "result", value: identified },
  };

  if (source.size > IN_BROWSER_DIGEST_LIMIT_BYTES) {
    outcomes[HASH_CAPABILITY] = {
      kind: "not-applicable",
      reason:
        "This file is too large to check in the browser. Magna Carta calculates the checksum when it's uploaded instead.",
    };
  } else {
    try {
      outcomes[HASH_CAPABILITY] = {
        kind: "result",
        value: await digestBuffer(await source.arrayBuffer()),
      };
    } catch {
      // No Error ID: the read failed here, in this browser, and never reached the logging
      // pipeline that mints one.
      outcomes[HASH_CAPABILITY] = {
        kind: "failed",
        message: "The file could not be read all the way through.",
      };
    }
  }

  return {
    // A key for this list, not an identifier of anything. A workbench file is not an entity and
    // never becomes one, so it deliberately does not carry a minted `file_…` handle: a person
    // seeing one would reasonably read it as a document that exists somewhere.
    id: crypto.randomUUID(),
    name: source.name,
    sizeBytes: source.size,
    declaredMediaType: source.type,
    receivedAt: new Date(),
    preview: previewFor(identified.report.detected, prefix, source),
    outcomes,
    // Closes over the browser's own `File`, which does not duplicate the bytes until something
    // actually reads them. A capability that needs to send this file somewhere — Unlock, eventually
    // Metadata — calls this rather than reaching for a copy the arrival reading already took.
    readBytes: () => source.arrayBuffer().then((buffer) => new Uint8Array(buffer)),
  };
}

/**
 * The workbench's files for this session. A class rather than loose state so the matter host can
 * supply its own source against the same shape.
 */
export class EphemeralFileSource {
  files = $state<WorkbenchFile[]>([]);
  /** Files that arrived and are still being read. The rail shows them rather than hiding the wait. */
  arriving = $state<number>(0);

  /** Read every dropped file and put it on the workbench. Newest last, so the list does not jump. */
  async add(incoming: readonly File[]): Promise<void> {
    if (incoming.length === 0) return;
    this.arriving += incoming.length;
    try {
      // Read in order rather than all at once: hashing several large files in parallel competes for
      // the same main thread and makes every one of them slower to appear.
      for (const source of incoming) {
        const file = await readArrival(source);
        this.files = [...this.files, file];
        this.arriving -= 1;
      }
    } finally {
      this.arriving = 0;
    }
  }

  /** Remove files from the workbench and release anything held for their preview. */
  discard(ids: readonly string[]): void {
    const removing = new Set(ids);
    for (const file of this.files) {
      if (removing.has(file.id) && file.preview.kind === "image") {
        URL.revokeObjectURL(file.preview.objectUrl);
      }
    }
    this.files = this.files.filter((file) => !removing.has(file.id));
  }

  discardAll(): void {
    this.discard(this.files.map((file) => file.id));
  }
}
