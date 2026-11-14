/*
 * Running one conversion: the file goes up, the job is queued, and the converted copy comes back.
 *
 * Four steps, each through the server's conversion routes: ask for an upload slot, put the bytes
 * straight into storage with the slot's signed URL (they never pass through the Worker), submit the
 * job naming the two formats, then read the job's state until it settles. A finished job carries a
 * short-lived signed URL, which is read at once into a Blob, so the copy lives in this browser like
 * everything else on the workbench.
 *
 * The steps are ports so a test can drive every outcome without a server.
 */
import { conversionsStatus, conversionsSubmit, conversionsUpload } from "@magna-carta/api-client";
import type { Format } from "@magna-carta/conversion/format";
import { failureOf } from "$lib/api/api-client.ts";

export type ConversionStage = "uploading" | "queued" | "converting";

export interface ConversionSlot {
  readonly jobId: string;
  readonly uploadUrl: string;
  readonly uploadHeaders: Readonly<Record<string, string>>;
  readonly sourceKey: string;
}

export interface ConversionState {
  readonly status: string;
  readonly url?: string;
  readonly mediaType?: string;
  readonly reason?: string;
}

export interface ConversionPorts {
  slot(): Promise<ConversionSlot>;
  putBytes(
    url: string,
    headers: Readonly<Record<string, string>>,
    bytes: Uint8Array,
  ): Promise<void>;
  submit(body: { jobId: string; sourceKey: string; from: string; to: string }): Promise<void>;
  state(jobId: string): Promise<ConversionState>;
  fetchResult(url: string): Promise<Blob>;
  wait(milliseconds: number): Promise<void>;
}

export type ConversionOutcome =
  | { readonly kind: "converted"; readonly blob: Blob; readonly mediaType: string }
  | { readonly kind: "failed"; readonly message: string };

/** How often a running job is asked about, and how long before the wait is given up. */
export const POLL_INTERVAL_MILLISECONDS = 1500;
export const POLL_LIMIT = 400;

/** The reader's sentence for a failure at one of the steps. */
function sentenceFor(
  error: unknown,
  step: "slot" | "upload" | "submit" | "state" | "result",
): string {
  const problem = failureOf(error).problem;
  if (problem?.status === 422) return "There is no way to convert between these two formats.";
  if (problem?.status === 403) return "Your role does not include converting files.";
  if (problem?.status === 503) return "The conversion engine is not running yet.";
  if (problem !== null && problem !== undefined)
    return problem.detail ?? problem.title ?? "The conversion was refused.";
  switch (step) {
    case "upload":
      return "The file could not be sent for conversion.";
    case "result":
      return "The converted copy could not be fetched.";
    default:
      return "Couldn't connect. Nothing was converted.";
  }
}

export async function runConversion(
  ports: ConversionPorts,
  bytes: Uint8Array,
  from: string,
  to: string,
  onStage?: (stage: ConversionStage) => void,
): Promise<ConversionOutcome> {
  let slot: ConversionSlot;
  try {
    onStage?.("uploading");
    slot = await ports.slot();
  } catch (error) {
    return { kind: "failed", message: sentenceFor(error, "slot") };
  }
  try {
    await ports.putBytes(slot.uploadUrl, slot.uploadHeaders, bytes);
  } catch (error) {
    return { kind: "failed", message: sentenceFor(error, "upload") };
  }
  try {
    await ports.submit({ jobId: slot.jobId, sourceKey: slot.sourceKey, from, to });
  } catch (error) {
    return { kind: "failed", message: sentenceFor(error, "submit") };
  }
  onStage?.("queued");

  for (let attempt = 0; attempt < POLL_LIMIT; attempt += 1) {
    let state: ConversionState;
    try {
      state = await ports.state(slot.jobId);
    } catch (error) {
      return { kind: "failed", message: sentenceFor(error, "state") };
    }
    if (state.status === "done" && state.url !== undefined) {
      try {
        const blob = await ports.fetchResult(state.url);
        return { kind: "converted", blob, mediaType: state.mediaType ?? blob.type };
      } catch (error) {
        return { kind: "failed", message: sentenceFor(error, "result") };
      }
    }
    if (state.status === "failed") {
      return {
        kind: "failed",
        message: state.reason ?? "The conversion engine could not convert this file.",
      };
    }
    if (state.status === "expired") {
      return {
        kind: "failed",
        message: "The converted copy was cleared before it could be fetched. Convert it again.",
      };
    }
    if (state.status === "running") onStage?.("converting");
    await ports.wait(POLL_INTERVAL_MILLISECONDS);
  }
  return { kind: "failed", message: "The conversion is taking too long. Try again later." };
}

/** The converted copy's name: the same stem with the new format's extension. */
export function convertedName(name: string, format: Pick<Format, "extensions">): string {
  const extension = format.extensions[0] ?? "";
  const dot = name.lastIndexOf(".");
  const stem = dot <= 0 ? name : name.slice(0, dot);
  const candidate = extension === "" ? stem : `${stem}.${extension}`;
  if (candidate.toLowerCase() !== name.toLowerCase()) return candidate;
  return extension === "" ? `${stem} (converted)` : `${stem} (converted).${extension}`;
}

/** The ports as the app runs them: the generated client, and the browser's own fetch for storage. */
export function browserConversionPorts(fetchImpl: typeof fetch = fetch): ConversionPorts {
  return {
    async slot() {
      const { data } = await conversionsUpload({ throwOnError: true });
      return data;
    },
    async putBytes(url, headers, bytes) {
      const response = await fetchImpl(url, {
        method: "PUT",
        headers: { ...headers },
        body: new Uint8Array(bytes),
      });
      if (!response.ok) throw new Error(`Storage refused the upload (${response.status}).`);
    },
    async submit(body) {
      await conversionsSubmit({ body, throwOnError: true });
    },
    async state(jobId) {
      const { data } = await conversionsStatus({ path: { jobId }, throwOnError: true });
      return data;
    },
    async fetchResult(url) {
      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(`Storage refused the download (${response.status}).`);
      return response.blob();
    },
    wait(milliseconds) {
      return new Promise((resolve) => setTimeout(resolve, milliseconds));
    },
  };
}
