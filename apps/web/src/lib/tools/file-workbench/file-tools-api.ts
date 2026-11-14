/*
 * The two server tools the workbench sends a file to when asked: repair (diagnose, repair, carve)
 * and text recognition (read the text, or return a searchable PDF).
 *
 * Both routes take the file's bytes as the body and keep nothing: each is a request that reads the
 * bytes, answers, and forgets them, the way the Unlock tab's request does. They run only when a
 * person presses the button, never on arrival, because they send the file off this browser.
 */
import type { ApiOutcome } from "$lib/api/request.ts";
import { readProblem, requestLine } from "$lib/api/problem.ts";

export interface RepairDiagnosis {
  readonly detectedFormat: string | null;
  readonly corruption: readonly string[];
  readonly recoverability: string;
  readonly repairSupported: boolean;
  readonly carveSuggested: boolean;
  readonly detail: string;
}

export interface SalvagedFile {
  readonly name: string;
  readonly mediaType: string | null;
  readonly contentBase64: string;
}

export interface RecoveredItem {
  readonly name: string;
  readonly recovered: boolean;
  readonly detail: string;
}

export interface RepairResult {
  readonly files: readonly SalvagedFile[];
  readonly loss: {
    readonly items: readonly RecoveredItem[];
    readonly fullyRecovered: boolean;
    readonly synthesized: readonly string[];
  };
}

export interface RecognizedLine {
  readonly text: string;
  readonly confidence: number;
}

export interface RecognizedPage {
  readonly pageIndex: number;
  readonly lines: readonly RecognizedLine[];
  readonly undecodedRegions: number;
  readonly skipped?: string | null;
}

export interface Recognition {
  readonly pages: readonly RecognizedPage[];
}

async function postBytes(
  fetchImpl: typeof fetch,
  path: string,
  bytes: Uint8Array,
): Promise<{ response: Response } | { outcome: ApiOutcome<never> }> {
  const line = requestLine("POST", path);
  try {
    const response = await fetchImpl(path, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: new Uint8Array(bytes),
    });
    if (!response.ok) {
      const problem = await readProblem(response);
      return {
        outcome: { kind: "problem", problem, failure: { problem, request: line, failedAt: new Date() } },
      };
    }
    return { response };
  } catch {
    return {
      outcome: { kind: "transport", failure: { problem: null, request: line, failedAt: new Date() } },
    };
  }
}

async function postBytesForJson<T>(
  fetchImpl: typeof fetch,
  path: string,
  bytes: Uint8Array,
): Promise<ApiOutcome<T>> {
  const sent = await postBytes(fetchImpl, path, bytes);
  if ("outcome" in sent) return sent.outcome;
  return { kind: "ok", value: (await sent.response.json()) as T };
}

export function diagnoseFile(fetchImpl: typeof fetch, bytes: Uint8Array): Promise<ApiOutcome<RepairDiagnosis>> {
  return postBytesForJson(fetchImpl, "/api/v1/file-repair/diagnose", bytes);
}

export function repairFile(fetchImpl: typeof fetch, bytes: Uint8Array): Promise<ApiOutcome<RepairResult>> {
  return postBytesForJson(fetchImpl, "/api/v1/file-repair/repair", bytes);
}

export function carveFile(fetchImpl: typeof fetch, bytes: Uint8Array): Promise<ApiOutcome<RepairResult>> {
  return postBytesForJson(fetchImpl, "/api/v1/file-repair/carve", bytes);
}

export function recognizeText(fetchImpl: typeof fetch, bytes: Uint8Array): Promise<ApiOutcome<Recognition>> {
  return postBytesForJson(fetchImpl, "/api/v1/ocr", bytes);
}

/** The same PDF with an invisible text layer over every scanned page. */
export async function searchablePdf(fetchImpl: typeof fetch, bytes: Uint8Array): Promise<ApiOutcome<Blob>> {
  const sent = await postBytes(fetchImpl, "/api/v1/ocr/searchable", bytes);
  if ("outcome" in sent) return sent.outcome;
  return { kind: "ok", value: await sent.response.blob() };
}
