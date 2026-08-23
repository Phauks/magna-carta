import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import type { FirmId } from "@magna-carta/identifiers/types";
import { aiProcessingEligibilityDefinition } from "@magna-carta/inference/settings";
import type { InferencePort } from "@magna-carta/inference/port";

// The time-narrative / UTBMS-suggestion producer — the first real consumer of InferencePort. It is
// DARK: no route wires it live, and the call-site reaches a model only after the firm's AI-processing
// gate is on. Privilege never rides an implicit yes, so the gate is off by default and the disabled
// path reaches no model at all. When the gate flips on (with the consent surface that owns it), this
// same call-site streams a draft over generateStream; until then it returns a typed feature-disabled
// result. The live suggestion feature ships in slice 3·5.

// The suggestion request: the firm + matter the narrative is for, plus optional context the prompt is
// fingerprinted over. Carries no privileged content beyond what the suggestion is built from.
export interface NarrativeSuggestionInput {
  readonly firmId: string;
  readonly matterId: string;
  readonly utbmsContext?: string;
  readonly userHistorySeed?: string;
}

export type NarrativeSuggestionResult =
  | { readonly status: "feature-disabled" }
  | { readonly status: "suggested"; readonly stream: AsyncIterable<string> }
  | { readonly status: "unavailable" };

export interface SuggestNarrativeOptions {
  readonly modelId: string;
  readonly input: NarrativeSuggestionInput;
}

// The producer's stable per-run idempotency anchor: a hex digest over (firmId, matterId, the
// prompt-fingerprinting context). Identical inputs yield an identical key, so a redelivered run
// collapses to one spend + one meter through the consumer's two guards. Opaque (a digest, not the raw
// prompt) so it leaks no narrative content into a key column. NUL bytes (\x00) separate fields so
// "a" + "bc" and "ab" + "c" produce distinct digests. Uses the Web Crypto API (available globally in
// Cloudflare Workers) rather than node:crypto, which is not in the worker's typecheck scope.
export async function buildInferenceJobIdempotencyKey(
  input: NarrativeSuggestionInput,
): Promise<string> {
  const encoder = new TextEncoder();
  // Concatenate fields with NUL-byte delimiters — same boundary as the prior sha256 chain.
  const payload = [
    input.firmId,
    "\x00",
    input.matterId,
    "\x00",
    input.utbmsContext ?? "",
    "\x00",
    input.userHistorySeed ?? "",
  ].join("");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(payload));
  const fingerprint = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `narrative:${fingerprint}`;
}

// Compose the prompt from matter context — kept here, not in the prompt-bearing job, so the
// fingerprint and the streamed prompt are built from the same source.
function composePrompt(input: NarrativeSuggestionInput): string {
  const lines = [
    `Suggest a concise time-entry narrative for matter ${input.matterId}.`,
    input.utbmsContext ? `UTBMS context: ${input.utbmsContext}.` : "",
    input.userHistorySeed ? `Recent narratives for tone: ${input.userHistorySeed}.` : "",
  ];
  return lines.filter((line) => line !== "").join(" ");
}

// Reach a model ONLY when the firm's AI-processing gate is on. The default (no row) is off, so the
// disabled branch returns before any port.generateStream — no model is reached. The read is total (a
// missing or invalid stored value yields the safe default off), mirroring readFirmSetting's contract.
export async function suggestNarrative(
  firmDatabase: SqlDatabase,
  port: InferencePort,
  options: SuggestNarrativeOptions,
): Promise<NarrativeSuggestionResult> {
  const eligible = await readFirmSetting(firmDatabase, aiProcessingEligibilityDefinition);
  if (!eligible) return { status: "feature-disabled" };

  const dispatch = await port.generateStream({
    modelId: options.modelId,
    prompt: composePrompt(options.input),
    firmId: options.input.firmId as FirmId,
  });
  if (!dispatch.ok) return { status: "unavailable" };
  return { status: "suggested", stream: dispatch.value.stream };
}
