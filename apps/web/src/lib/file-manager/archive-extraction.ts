/*
 * Taking members out of an archive, and saying what happened.
 *
 * TWO THINGS THE SURFACE MUST NOT DECIDE FOR ITSELF, so both live here. The first is how a request
 * is split: the host takes a bounded number of members at a time, and a reader who selected four
 * hundred of them should not have to know that. The second is what a refusal MEANS — a member can
 * fail to come out for eight different reasons and each one tells the reader something different
 * about their own archive, so collapsing them into "some files could not be extracted" throws away
 * the only part they can act on.
 *
 * Pure over an injected fetch: the whole vocabulary is unit-testable without a DOM.
 */
import type { ApiOutcome } from "$lib/api/request.ts";
import {
  extractArchiveMembers,
  type ArchiveExtraction,
  type ExtractionRefusalReason,
} from "./matter-file-api.ts";

/**
 * How many members go in one request. The host caps a request at this, so the cap lives here too
 * rather than being discovered as a refusal.
 */
export const EXTRACTION_BATCH_SIZE = 100;

/** What a whole extraction settled to, however many requests it took. */
export type ExtractionOutcome =
  | { readonly kind: "done"; readonly result: ArchiveExtraction }
  /** No request was made, because nothing was asked for. */
  | { readonly kind: "nothing-asked" }
  | Exclude<ApiOutcome<never>, { kind: "ok" }>;

/**
 * Run the extraction, in as many requests as the batch size requires, merging the answers.
 *
 * A failing batch ends the run and is reported as itself: what already landed stays landed (the
 * host filed it), and the surface re-reads the matter either way, so the reader sees exactly what
 * arrived rather than a claim about it.
 */
export async function runExtraction(
  fetchImpl: typeof fetch,
  input: {
    readonly fileId: string;
    readonly paths: readonly string[];
    readonly folderId: string | null;
  },
  newIdempotencyKey: () => string = () => crypto.randomUUID(),
): Promise<ExtractionOutcome> {
  if (input.paths.length === 0) return { kind: "nothing-asked" };
  const extracted: ArchiveExtraction["extracted"][number][] = [];
  const refused: ArchiveExtraction["refused"][number][] = [];
  for (let at = 0; at < input.paths.length; at += EXTRACTION_BATCH_SIZE) {
    const batch = input.paths.slice(at, at + EXTRACTION_BATCH_SIZE);
    // Sequential on purpose: each batch writes files and runs the scan gate, and firing twenty of
    // those at once would be this screen deciding the host's concurrency for it.
    const outcome = await extractArchiveMembers(
      fetchImpl,
      input.fileId,
      batch,
      input.folderId,
      newIdempotencyKey(),
    );
    if (outcome.kind !== "ok") return outcome;
    extracted.push(...outcome.value.extracted);
    refused.push(...outcome.value.refused);
  }
  return { kind: "done", result: { extracted, refused } };
}

/** What each refusal means, in the reader's words and about their own archive. */
const REFUSAL_WORDS: Readonly<Record<ExtractionRefusalReason, string>> = {
  "archive-missing": "the archive's contents are no longer in storage",
  directory: "it is a folder inside the archive, not a file",
  encrypted: "it is password-protected inside the archive",
  "unsupported-compression": "it is packed in a way this application cannot open",
  malformed: "the archive's own record of where it sits does not hold together",
  "too-large": "it is larger than this firm allows to be extracted at once",
  "expansion-ratio": "it expands far enough to be treated as unsafe",
  corrupt: "its contents do not match what the archive recorded for it",
  "policy-size": "it is larger than this firm allows a file to be",
  "policy-type": "this firm does not accept files of its kind",
  "not-found": "it is no longer in the archive",
};

export function refusalWords(reason: ExtractionRefusalReason): string {
  return REFUSAL_WORDS[reason];
}

/**
 * One sentence for the whole extraction, in the reader's words.
 *
 * The rules it holds: a count is always stated, a refusal is never silent, and where every member
 * was refused for the SAME reason that reason is named rather than counted — "all three are
 * password-protected" is what a reader needs, and "3 could not be extracted" is not.
 */
export function extractionSentence(result: ArchiveExtraction): string {
  const landed = result.extracted.length;
  const refused = result.refused.length;
  const filesLanded = `${String(landed)} ${landed === 1 ? "file" : "files"}`;
  if (refused === 0) return `Extracted ${filesLanded} into the matter.`;

  const reasons = new Set(result.refused.map((entry) => entry.reason));
  const sharedReason =
    reasons.size === 1 ? refusalWords([...reasons][0] as ExtractionRefusalReason) : null;
  const refusedCount = `${String(refused)} ${refused === 1 ? "was" : "were"} not`;
  if (landed === 0) {
    return sharedReason === null
      ? `Nothing was extracted: ${String(refused)} could not be taken out of the archive.`
      : refused === 1
        ? `Nothing was extracted: ${sharedReason}.`
        : `Nothing was extracted: all ${String(refused)} are ones where ${sharedReason}.`;
  }
  return sharedReason === null
    ? `Extracted ${filesLanded} into the matter; ${refusedCount}.`
    : `Extracted ${filesLanded} into the matter; ${refusedCount}, because ${sharedReason}.`;
}
