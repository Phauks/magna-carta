/*
 * What the player page says when a recording will not play here, and how a moment in a recording
 * is addressed. Pure, so the words are tested once and every surface that offers a recording reads
 * the same ones.
 */
import type { PlayableCopyStatus, PreviewGrant } from "$lib/file-manager/matter-file-api.ts";

/** Why a recording is offered as a download instead of playing. */
export type CannotPlayCause = Pick<PreviewGrant, "verdict" | "reason"> | "browser-refused";

export const CANNOT_PLAY_TITLE = "Unreadable Media File";

/**
 * Whether converting to MP4 could help: the converter reads MP4, QuickTime and Matroska, and only
 * a refusal about the recording's own encoding is one a copy can cure. A recording that will not
 * stream for any other reason (archive storage, the site's streaming not set up) would make a copy
 * that will not stream either.
 */
export function offersConversion(cause: CannotPlayCause, contentType: string | null): boolean {
  if (!CONVERTIBLE_TYPES.has(contentType ?? "")) return false;
  if (cause === "browser-refused") return true;
  return cause.reason === "verdict";
}

const CONVERTIBLE_TYPES = new Set([
  "video/mp4",
  "video/x-m4v",
  "video/quicktime",
  "video/x-matroska",
]);

/** The sentence under the title: what is true about this recording, then what to do. */
export function cannotPlaySentence(cause: CannotPlayCause, convertible = false): string {
  const remedy = convertible
    ? "Convert it to MP4 to watch it here, or download it to watch it in a video application."
    : "Download it to watch it in a video application.";
  if (cause === "browser-refused") {
    return `This browser cannot decode its picture or sound. ${remedy}`;
  }
  switch (cause.reason) {
    case "verdict":
      return cause.verdict === "indeterminate"
        ? `How it is encoded could not be read from the file. ${remedy}`
        : `Its picture or sound is in a format no browser decodes, such as ProRes video or ` +
            `Dolby Digital sound. ${remedy}`;
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

/** What the page says about the MP4 copy once one has been asked for, or null when there is none. */
export function conversionSentence(status: PlayableCopyStatus): string | null {
  switch (status.state) {
    case "pending":
      return "Converting to MP4. Long recordings take a few minutes. You can leave this page; the MP4 is saved beside the original when it's done.";
    case "ready":
      return "The MP4 is saved beside the original in the same folder.";
    case "unavailable":
      switch (status.reason) {
        case "malformed":
          return "It could not be converted: the file looks damaged, or is not what its type says.";
        case "too-large":
          return "It could not be converted: it is larger than two gigabytes or longer than six hours.";
        case "source-missing":
          return "It could not be converted: the original's contents could not be found.";
        default:
          return "It couldn't be converted because its video or audio format isn't supported yet, such as ProRes, MPEG-2 or Windows Media.";
      }
    default:
      return null;
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

/**
 * What a still taken from a recording is saved as: the recording's own name without its extension,
 * and the moment, so a folder of stills from one deposition sorts and reads in order. The moment is
 * written with hyphens because a colon is not allowed in a file name on Windows.
 */
export function screenshotFileName(recordingName: string, seconds: number): string {
  const stem = recordingName.replace(/\.[^./\\]+$/u, "") || "Recording";
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = String(Math.floor((whole % 3600) / 60)).padStart(2, "0");
  const rest = String(whole % 60).padStart(2, "0");
  return `${stem} at ${String(hours)}-${minutes}-${rest}.png`;
}
