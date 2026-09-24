/*
 * Everything a capture found, taken away in one file: the screenshot, plus every fact the inspector
 * panel shows, in a form a person can read and a form a program can.
 *
 * ONE ARCHIVE, three entries:
 *   - the screenshot, as the PNG it already is;
 *   - `capture.txt`, the panel's facts written out for a reader — the thing to attach to a report or
 *     paste into a matter note;
 *   - `capture.json`, the same facts structured, for anyone who wants to process them.
 * A ZIP rather than three separate downloads because a browser prompting about several files and
 * then scattering them is the mess `apps/web/src/lib/export/bulk-download.ts` exists to avoid, and
 * it packs with the same library, so the platform has one answer to "put these files together".
 *
 * NOTHING IN THE ARCHIVE IS LIVE. No HTML, no markup, no hyperlinks: the suspect page's addresses and
 * text are written as plain text, the same promise the viewer makes on screen. A report opened later
 * in a browser or a word processor must not be the thing that finally lets the page act.
 *
 * The report and the record are built by pure functions so what they contain is pinned by tests
 * without a DOM; only `downloadCaptureArchive` touches the browser.
 */
import { downloadZip } from "client-zip";
import type { WhoisResult } from "$lib/tools/whois/whois-lookup.ts";
import {
  finalStatus,
  formatCaptureDuration,
  formatCaptureTime,
  headerValue,
  redirectCount,
  screenshotFilename,
} from "./capture-facts.ts";
import { landedOnDifferentHost, sortedHeaders, type SafeWebsiteView } from "./safe-browse.ts";

export interface CaptureExportInput {
  readonly view: SafeWebsiteView;
  readonly capturedAt: number;
  readonly elapsedMs: number;
  /** Which browser produced it — a held Live session and a fresh Static one see a page differently. */
  readonly mode: "static" | "live";
  /** The Registration tab's answer, when the member opened it for this host; absent otherwise. */
  readonly registration?: WhoisResult | null;
}

/** The archive's name: the screenshot's own name, so the two files a member keeps sort together. */
export function captureArchiveFilename(finalUrl: string, capturedAt: number): string {
  return screenshotFilename(finalUrl, capturedAt).replace(/\.png$/, ".zip");
}

function section(title: string, lines: readonly string[]): string {
  return [title, "-".repeat(title.length), ...lines, ""].join("\n");
}

/**
 * The panel's facts for a reader. Ordered as the tabs are, so someone who has the screen open and
 * the report beside it finds each fact where they expect it.
 */
export function captureReportText(input: CaptureExportInput): string {
  const { view } = input;
  const status = finalStatus(view);
  const contentType = headerValue(view.responseHeaders, "content-type");
  const server = headerValue(view.responseHeaders, "server");

  const overview: string[] = [
    `Requested address: ${view.requestedUrl}`,
    `Final address: ${view.finalUrl}`,
  ];
  if (landedOnDifferentHost(view)) {
    overview.push("Different site: yes — the link ended on a different site from where it started");
  }
  if (status !== null) overview.push(`Final status: ${status}`);
  if (contentType !== null) overview.push(`Content type: ${contentType}`);
  if (server !== null) overview.push(`Server: ${server}`);
  overview.push(`Redirects: ${redirectCount(view)}`);
  overview.push(`Outbound links: ${view.links.length}`);
  if (view.title) overview.push(`Page title: ${view.title}`);
  overview.push(`Captured: ${formatCaptureTime(input.capturedAt)}`);
  overview.push(`Capture duration: ${formatCaptureDuration(input.elapsedMs)}`);
  overview.push(
    `Mode: ${input.mode === "live" ? "Live (a held isolated browser)" : "Static (a fresh isolated browser)"}`,
  );

  const redirects =
    view.redirectChain.length === 0
      ? ["(none recorded)"]
      : view.redirectChain.map(
          (hop, index) =>
            `${index + 1}. ${hop.status} ${hop.url}${hop.location ? ` -> ${hop.location}` : ""}`,
        );

  const headers = sortedHeaders(view.responseHeaders).map(([name, value]) => `${name}: ${value}`);

  const registration: string[] = [];
  const record = input.registration;
  if (record) {
    registration.push(`Domain: ${record.target}`);
    if (record.registrar) registration.push(`Registrar: ${record.registrar}`);
    if (record.registrant) registration.push(`Registrant: ${record.registrant}`);
    if (record.registeredAt) registration.push(`Registered: ${record.registeredAt}`);
    if (record.expiresAt) registration.push(`Expires: ${record.expiresAt}`);
    if (record.lastChangedAt) registration.push(`Last changed: ${record.lastChangedAt}`);
    if (record.nameservers?.length) {
      registration.push(`Name servers: ${record.nameservers.join(", ")}`);
    }
    if (record.statuses?.length) registration.push(`Statuses: ${record.statuses.join(", ")}`);
    if (record.raw && !record.registrar) registration.push("", record.raw);
  }

  return [
    "SAFE WEBSITE VIEWER — CAPTURE REPORT",
    "",
    "Everything below was collected by an isolated remote browser. The page never ran on the",
    "computer that saved this report. Addresses are text, not links.",
    "",
    section("Overview", overview),
    section("Redirects", redirects),
    section("Page text", [view.markdown?.trim() || "(no text found)"]),
    section("Links", view.links.length === 0 ? ["(none)"] : [...view.links]),
    section("Headers", headers.length === 0 ? ["(none recorded)"] : headers),
    section(
      "Registration",
      registration.length === 0
        ? ["(not looked up — open the Registration tab before downloading to include it)"]
        : registration,
    ),
  ].join("\n");
}

/** The same facts, structured. The screenshot is its own archive entry, so it is not repeated here. */
export function captureRecord(input: CaptureExportInput): Record<string, unknown> {
  const { screenshotBase64: _screenshot, ...view } = input.view;
  return {
    capturedAt: new Date(input.capturedAt).toISOString(),
    captureDurationMilliseconds: input.elapsedMs,
    mode: input.mode,
    differentSite: landedOnDifferentHost(input.view),
    ...view,
    registration: input.registration ?? null,
  };
}

function decodeBase64(base64: string): Uint8Array {
  const body = base64.startsWith("data:") ? base64.slice(base64.indexOf(",") + 1) : base64;
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Build the archive and hand it to the browser to save. */
export async function downloadCaptureArchive(input: CaptureExportInput): Promise<void> {
  const lastModified = new Date(input.capturedAt);
  const entries: { name: string; input: string | Uint8Array; lastModified: Date }[] = [
    { name: "capture.txt", input: captureReportText(input), lastModified },
    {
      name: "capture.json",
      input: `${JSON.stringify(captureRecord(input), null, 2)}\n`,
      lastModified,
    },
  ];
  if (input.view.screenshotBase64 !== "") {
    entries.unshift({
      name: screenshotFilename(input.view.finalUrl, input.capturedAt),
      input: decodeBase64(input.view.screenshotBase64),
      lastModified,
    });
  }

  const blob = await downloadZip(entries).blob();
  const address = URL.createObjectURL(blob);
  // A programmatic anchor with the download attribute, never inserted into the page — the same way
  // the shell saves the screenshot on its own.
  const anchor = document.createElement("a");
  anchor.href = address;
  anchor.download = captureArchiveFilename(input.view.finalUrl, input.capturedAt);
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(address), 30_000);
}
