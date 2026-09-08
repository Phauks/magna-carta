/*
 * What the workbench knows about one file it was handed.
 *
 * A file here is EPHEMERAL. It belongs to no matter, it is never filed, and it carries no version
 * and no history — those only exist for a document that has a record to hang off. The same body
 * serves a matter's files one day; the difference between the two hosts is this model and the
 * source that supplies it, not the screen.
 *
 * Every fact a capability learns lands in `outcomes`, keyed by the capability's id. A capability
 * that has not run is `not-run`; one that has nothing to do on this file is `not-applicable` with
 * the reason; one that broke is `failed` with the correlated Error ID. There is no fourth silence
 * and there is no blank: a reader can always tell which of those three they are looking at.
 */

/**
 * What the malware scan concluded. A verdict is a fact about the file, never a gate on the screen.
 *
 * Three states, because three is what the scan can actually report and the design system's status
 * register already speaks all three. A workbench that invented a fourth word would be a second
 * status vocabulary, and two vocabularies disagree the moment either is corrected.
 */
export type ScanVerdict = "clean" | "flagged" | "unscanned";

/**
 * A capability's knowledge of one file. `not-run` and `not-applicable` are different silences and
 * are rendered differently; collapsing them into `null` is what produces a blank cell.
 */
export type CapabilityOutcome<TResult> =
  | { readonly kind: "result"; readonly value: TResult }
  | { readonly kind: "not-run" }
  | { readonly kind: "not-applicable"; readonly reason: string }
  | {
      readonly kind: "failed";
      readonly message: string;
      /**
       * The correlated Error ID, where the failure reached the server's logging pipeline. A failure
       * that happened entirely in this browser has none, and inventing one would hand a person a
       * reference that correlates to nothing.
       */
      readonly errorId?: string;
    };

/** Why a file cannot be shown, when it cannot. Reserving dead space for a preview is worse. */
export type PreviewState =
  | { readonly kind: "none"; readonly reason: string }
  | { readonly kind: "image"; readonly objectUrl: string }
  | { readonly kind: "text"; readonly excerpt: string };

export interface WorkbenchFile {
  /** Stable for as long as this file is on the workbench. Not an identifier of anything filed. */
  readonly id: string;
  readonly name: string;
  readonly sizeBytes: number;
  /** The browser's claim about the type, from the file picker. The bytes are the real answer. */
  readonly declaredMediaType: string;
  readonly receivedAt: Date;
  readonly preview: PreviewState;
  /** Keyed by capability id. Read it through `outcomeFor`, which types the result. */
  readonly outcomes: Readonly<Record<string, CapabilityOutcome<unknown>>>;
  /**
   * Read the whole file, for a capability that has to send it somewhere — Unlock and Metadata both
   * need the actual bytes, not a reading already taken from them. A function rather than the bytes
   * themselves, so a file nobody has asked to send anywhere never holds a second copy in memory:
   * this host closes over the browser's own `File`, which does not duplicate until read, and a
   * matter host would close over a fetch of the stored version instead. Rejects once the file has
   * been discarded from the workbench.
   */
  readonly readBytes: () => Promise<Uint8Array>;
}

/**
 * One capability's outcome for one file, typed. Every capability module owns its own result type
 * and reads through this, so the loosely-typed bag never leaks into a panel.
 */
export function outcomeFor<TResult>(
  file: WorkbenchFile,
  capabilityId: string,
): CapabilityOutcome<TResult> {
  return (
    (file.outcomes[capabilityId] as CapabilityOutcome<TResult> | undefined) ?? { kind: "not-run" }
  );
}

/*
 * Two capability ids the model itself reads, because what a file IS and whether it is safe are
 * facts about the file that other capabilities key their own behaviour off. Every other capability
 * id stays private to its own module.
 */
export const FILE_TYPE_CAPABILITY = "file-type";
export const MALWARE_SCAN_CAPABILITY = "malware-scan";

/** The scan verdict, or `unscanned` when the scan has not answered. Every surface reads it here. */
export function scanVerdictOf(file: WorkbenchFile): ScanVerdict {
  const outcome = outcomeFor<{ verdict: ScanVerdict }>(file, MALWARE_SCAN_CAPABILITY);
  return outcome.kind === "result" ? outcome.value.verdict : "unscanned";
}

/** Bytes as a person reads them. Two significant decimals is noise on a file size. */
export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} bytes`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** The exact count, for the places that want the byte figure rather than the readable one. */
export function formatExactBytes(bytes: number): string {
  return `${bytes.toLocaleString()} bytes`;
}
