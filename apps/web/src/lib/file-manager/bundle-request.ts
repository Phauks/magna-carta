/*
 * Download as Bundle: what the reader chose, the request it becomes, and what the server answered.
 *
 * The bundle route (`POST /api/v1/downloads/zip`) has four lanes and picks one from the options:
 * a plain ZIP (no options, or a ZIP with no compression, password or split) streams inline below
 * the firm's live threshold and builds in the background above it; anything else goes to the
 * bundle service, which streams a password-protected archive straight back and builds the rest in
 * the background. This module decides nothing the server decides. It turns the dialog's choices
 * into the request, refuses only the combinations the server would refuse, and names each answer
 * so the screen can act on it.
 *
 * The password is never stored, logged or kept beyond the request: it travels in the body beside
 * the options, which is where the route reads it, and nowhere else.
 */
import type { ApiOutcome } from "$lib/api/request.ts";
import { requestJson } from "$lib/api/request.ts";
import { readProblem, requestLine } from "$lib/api/problem.ts";

export type BundleFormat = "zip" | "sevenZip";
export type BundleCompression = "store" | "normal" | "maximum";
export type BundleLayout = "preserveTree" | "flatten";

export interface BundleChoices {
  readonly format: BundleFormat;
  readonly compression: BundleCompression;
  /** Empty means no password, and no encryption. */
  readonly password: string;
  /** Null means one file. Only a 7z archive splits. */
  readonly partBytes: number | null;
  readonly layout: BundleLayout;
  readonly manifest: boolean;
}

export const DEFAULT_BUNDLE_CHOICES: BundleChoices = {
  format: "zip",
  compression: "normal",
  password: "",
  partBytes: null,
  layout: "preserveTree",
  manifest: true,
};

/** One row of a Select: the value it stores and the words it shows. */
interface ChoiceItem {
  value: string;
  label: string;
}

export const FORMAT_ITEMS: ChoiceItem[] = [
  { value: "zip", label: "Zip" },
  { value: "sevenZip", label: "7z" },
];

export const COMPRESSION_ITEMS: ChoiceItem[] = [
  { value: "store", label: "None" },
  { value: "normal", label: "Normal" },
  { value: "maximum", label: "Smallest" },
];

const MEGABYTE = 1_000_000;

/** Sizes that fit the places a split archive usually has to go: an email, a disc, a file share. */
export const SPLIT_ITEMS: ChoiceItem[] = [
  { value: "none", label: "Do not split" },
  { value: String(20 * MEGABYTE), label: "20 MB (email)" },
  { value: String(100 * MEGABYTE), label: "100 MB" },
  { value: String(650 * MEGABYTE), label: "650 MB (CD)" },
  { value: String(4_000 * MEGABYTE), label: "4 GB (DVD)" },
];

export const LAYOUT_ITEMS: ChoiceItem[] = [
  { value: "preserveTree", label: "Keep" },
  { value: "flatten", label: "Flatten" },
];

const EXTENSIONS: Readonly<Record<BundleFormat, string>> = { zip: "zip", sevenZip: "7z" };

/**
 * Why the choices cannot be sent, or undefined when they can. The same two rules the route checks
 * (`validateOptionsForFormat` in packages/file-manager/src/bundle-formats.ts), said to a person.
 */
export function bundleRefusal(choices: BundleChoices): string | undefined {
  if (choices.partBytes !== null && choices.format !== "sevenZip") {
    return "Only a 7z archive can be split into parts.";
  }
  if (choices.partBytes !== null && choices.password !== "") {
    return "A password-protected bundle comes as one file, so it cannot also be split.";
  }
  return undefined;
}

/** A plain ZIP with nothing asked of it: the route's fast lane, which needs no bundle service. */
export function isPlainZip(choices: BundleChoices): boolean {
  return (
    choices.format === "zip" &&
    choices.compression === "store" &&
    choices.password === "" &&
    choices.partBytes === null &&
    choices.layout === "preserveTree" &&
    !choices.manifest
  );
}

/** A name a file system takes: the matter's name with anything a path would choke on replaced. */
export function bundleStem(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned === "" ? "Bundle" : cleaned.slice(0, 200);
}

export interface BundleSelection {
  readonly matterId: string;
  readonly fileIds: readonly string[];
  readonly folderIds: readonly string[];
}

/** The request body. Options are left out for a plain ZIP so it rides the fast lane unchanged. */
export function bundleRequestBody(
  selection: BundleSelection,
  choices: BundleChoices,
  stem: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    matterId: selection.matterId,
    fileIds: [...selection.fileIds],
    folderIds: [...selection.folderIds],
  };
  if (isPlainZip(choices)) return body;
  const encrypted = choices.password !== "";
  body["options"] = {
    format: choices.format,
    compression: choices.compression,
    // A 7z archive can hide its list of names as well as its contents; a ZIP cannot.
    encryption: encrypted
      ? { algorithm: "aes-256", encryptFileNames: choices.format === "sevenZip" }
      : null,
    split: choices.partBytes === null ? null : { maxPartBytes: choices.partBytes },
    outputName: `${stem}.${EXTENSIONS[choices.format]}`,
    wrapperFolder: null,
    layout: choices.layout,
    manifest: choices.manifest,
  };
  if (encrypted) body["password"] = choices.password;
  return body;
}

/** What the server did with the request. */
export type BundleAnswer =
  /** The archive itself, streamed back now. */
  | { readonly kind: "archive"; readonly archive: Blob; readonly name: string }
  /** Already built: one link, or one per part. */
  | { readonly kind: "links"; readonly urls: readonly string[] }
  /** Building in the background; poll with this id. */
  | { readonly kind: "building"; readonly jobId: string }
  /** The selection came down to one file, which the route hands over as that file. */
  | { readonly kind: "single-file" };

function fileNameFrom(disposition: string | null, fallback: string): string {
  const match = disposition?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? fallback;
}

/**
 * Send the request and read the answer. Never throws: a refusal comes back as the route's own
 * problem document, and a server that did not answer as a transport failure.
 */
export async function requestBundle(
  fetchImpl: typeof fetch,
  body: Record<string, unknown>,
  fallbackName: string,
): Promise<ApiOutcome<BundleAnswer>> {
  const path = "/api/v1/downloads/zip";
  const line = requestLine("POST", path);
  let response: Response;
  try {
    response = await fetchImpl(path, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
      // A one-file selection redirects to storage; following it here would pull the file through
      // this tab, so the redirect is read as the answer it is instead.
      redirect: "manual",
    });
  } catch {
    const failure = { problem: null, request: line, failedAt: new Date() };
    return { kind: "transport", failure };
  }
  if (response.type === "opaqueredirect" || response.status === 302) {
    return { kind: "ok", value: { kind: "single-file" } };
  }
  if (!response.ok) {
    const problem = await readProblem(response);
    return { kind: "problem", problem, failure: { problem, request: line, failedAt: new Date() } };
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = (await response.json()) as { jobId?: string; url?: string; urls?: string[] };
    if (response.status === 202 && typeof json.jobId === "string") {
      return { kind: "ok", value: { kind: "building", jobId: json.jobId } };
    }
    const urls = json.urls ?? (json.url === undefined ? [] : [json.url]);
    return { kind: "ok", value: { kind: "links", urls } };
  }
  const archive = await response.blob();
  const name = fileNameFrom(response.headers.get("content-disposition"), fallbackName);
  return { kind: "ok", value: { kind: "archive", archive, name } };
}

export interface BundleStatus {
  readonly status: string;
  readonly url?: string;
  readonly urls?: readonly string[];
}

/** Where a background build stands. `ready` carries the link or the links. */
export function readBundleStatus(
  fetchImpl: typeof fetch,
  jobId: string,
): Promise<ApiOutcome<BundleStatus>> {
  return requestJson(fetchImpl, `/api/v1/downloads/bundles/${encodeURIComponent(jobId)}`);
}

/** The links a ready build hands back, in part order. */
export function linksOf(status: BundleStatus): readonly string[] {
  return status.urls ?? (status.url === undefined ? [] : [status.url]);
}
