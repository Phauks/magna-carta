/*
 * What the player page says when a recording will not play here, and how a moment in a recording
 * is addressed. Pure, so the words are tested once and every surface that offers a recording reads
 * the same ones.
 */
import type { PreviewGrant } from "$lib/file-manager/matter-file-api.ts";

/** Why a recording is offered as a download instead of playing. */
export type CannotPlayCause = Pick<PreviewGrant, "verdict" | "reason"> | "browser-refused";

export const CANNOT_PLAY_TITLE = "This Video Cannot Play in the Browser";

/** The sentence under the title: what is true about this recording, then what to do. */
export function cannotPlaySentence(cause: CannotPlayCause): string {
  const remedy = "Download it to watch it in a video application.";
  if (cause === "browser-refused") {
    return `This browser could not decode it. ${remedy}`;
  }
  switch (cause.reason) {
    case "verdict":
      return cause.verdict === "indeterminate"
        ? `How it is encoded could not be read from the file. ${remedy}`
        : `Its picture or sound is in a format browsers do not decode, such as the HEVC video ` +
            `many phones record. ${remedy}`;
    case "unknown-verdict":
      return `Its format could not be checked just now. Reopen it to try again, or download it.`;
    case "tiered":
      return `It has moved to archive storage, which is not streamed. ${remedy}`;
    case "host-unavailable":
      return `Streaming is not set up on this site yet. ${remedy}`;
    default:
      return `It is not stored in a form that can be streamed. ${remedy}`;
  }
}

/**
 * The second a `?t=` address asks the player to start at, or 0. Only a whole number of seconds is
 * read: a link is copied at a second, and anything else in the parameter is not one of ours.
 */
export function startSecondOf(search: URLSearchParams): number {
  const raw = search.get("t");
  if (raw === null || !/^\d{1,6}$/u.test(raw)) return 0;
  return Number(raw);
}

/** The address that opens the recording at `seconds`. */
export function momentHref(origin: string, fileId: string, seconds: number): string {
  const second = Math.max(0, Math.floor(seconds));
  return `${origin}/documents/${encodeURIComponent(fileId)}/watch?t=${second}`;
}
