/*
 * The two server tools the workbench sends a file to when asked: repair (diagnose, repair, carve)
 * and text recognition (read the text, or return a searchable PDF).
 *
 * Both routes take the file's bytes as the body and keep nothing: each is a request that reads the
 * bytes, answers, and forgets them, the way the Unlock tab's request does. They run only when a
 * person presses the button, never on arrival, because they send the file off this browser. The
 * calls go through the generated client; the shapes below are the parts of each answer the panels
 * read, so a panel test can build one without the whole contract type.
 */
import {
  fileRepairCarve,
  fileRepairDiagnose,
  fileRepairRepair,
  ocrRecognize,
  ocrSearchable,
} from "@magna-carta/api-client";
import { outcomeOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";
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

/** The body the generated client sends untouched: its octet-stream operations skip serializing. */
function bodyOf(bytes: Uint8Array): Blob {
  return new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" });
}

export async function diagnoseFile(bytes: Uint8Array): Promise<ApiOutcome<RepairDiagnosis>> {
  try {
    const { data } = await fileRepairDiagnose({ body: bodyOf(bytes), throwOnError: true });
    return { kind: "ok", value: data as RepairDiagnosis };
  } catch (error) {
    return outcomeOf(error);
  }
}

export async function repairFile(bytes: Uint8Array): Promise<ApiOutcome<RepairResult>> {
  try {
    const { data } = await fileRepairRepair({ body: bodyOf(bytes), throwOnError: true });
    return { kind: "ok", value: data as RepairResult };
  } catch (error) {
    return outcomeOf(error);
  }
}

export async function carveFile(bytes: Uint8Array): Promise<ApiOutcome<RepairResult>> {
  try {
    const { data } = await fileRepairCarve({ body: bodyOf(bytes), throwOnError: true });
    return { kind: "ok", value: data as RepairResult };
  } catch (error) {
    return outcomeOf(error);
  }
}

export async function recognizeText(bytes: Uint8Array): Promise<ApiOutcome<Recognition>> {
  try {
    const { data } = await ocrRecognize({ body: bodyOf(bytes), throwOnError: true });
    return { kind: "ok", value: data as Recognition };
  } catch (error) {
    return outcomeOf(error);
  }
}

/** The same PDF with an invisible text layer over every scanned page. */
export async function searchablePdf(bytes: Uint8Array): Promise<ApiOutcome<Blob>> {
  try {
    const { data } = await ocrSearchable({
      body: bodyOf(bytes),
      parseAs: "blob",
      throwOnError: true,
    });
    return { kind: "ok", value: data as unknown as Blob };
  } catch (error) {
    return outcomeOf(error);
  }
}
