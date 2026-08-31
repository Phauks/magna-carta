/*
 * Derived facts about a completed capture — the pure readings behind the Overview tab and the
 * shell's screenshot actions. Everything here derives from data the capture already returned
 * (nothing is fetched), and the module stays DOM-free so the derivations are unit-testable
 * (apps/web/test/capture-facts.test.ts).
 */

import type { SafeWebsiteView } from "./safe-browse.ts";

/**
 * The HTTP status the capture ended on — the last redirect-chain hop's status, because the chain
 * ends with the final response. Null when the renderer reported no chain at all, so the row can
 * be omitted rather than invented.
 */
export function finalStatus(view: SafeWebsiteView): number | null {
  const lastHop = view.redirectChain.at(-1);
  return lastHop?.status ?? null;
}

/**
 * A response header's value, matched case-insensitively — header names are case-insensitive on
 * the wire and the renderer does not promise a casing. Null when the response did not carry it.
 */
export function headerValue(headers: Record<string, string>, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const [headerName, value] of Object.entries(headers)) {
    if (headerName.toLowerCase() === wanted) return value;
  }
  return null;
}

/**
 * How many redirects the capture followed: the chain hops that answered with a 3xx. The chain
 * also records the final non-redirect response, so counting entries would overstate by one.
 */
export function redirectCount(view: SafeWebsiteView): number {
  return view.redirectChain.filter((hop) => hop.status >= 300 && hop.status < 400).length;
}

/** The hostname of a captured URL, or null when it cannot be parsed — never a thrown error. */
export function finalHost(url: string): string | null {
  try {
    const { hostname } = new URL(url);
    return hostname === "" ? null : hostname;
  } catch {
    return null;
  }
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The filename a downloaded screenshot saves as: the landed host plus the capture's local
 * date-time to the minute, so two downloads of one site stay distinguishable. The host is
 * sanitized to filename-safe characters; an unparseable URL falls back to "capture".
 */
export function screenshotFilename(finalUrl: string, capturedAt: number): string {
  const host = finalHost(finalUrl) ?? "capture";
  const sanitizedHost =
    host
      .toLowerCase()
      .replaceAll(/[^a-z0-9.-]+/g, "-")
      .replaceAll(/^-+|-+$/g, "") || "capture";
  const when = new Date(capturedAt);
  const stamp =
    `${when.getFullYear()}${twoDigits(when.getMonth() + 1)}${twoDigits(when.getDate())}` +
    `-${twoDigits(when.getHours())}${twoDigits(when.getMinutes())}`;
  return `safe-capture-${sanitizedHost}-${stamp}.png`;
}

/** When the capture completed, in the member's locale. */
export function formatCaptureTime(capturedAt: number): string {
  return new Date(capturedAt).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** How long the capture took, as seconds with one decimal ("12.3s"). */
export function formatCaptureDuration(elapsedMs: number): string {
  return `${(elapsedMs / 1000).toFixed(1)}s`;
}
