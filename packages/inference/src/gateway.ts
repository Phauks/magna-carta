import type { FirmId } from "@magna-carta/identifiers/types";
import { adapterError, ok, type Dispatch } from "@magna-carta/integrations/dispatch";
import { integrationProblem, type IntegrationProblem } from "@magna-carta/integrations/problem";
import { catalogEntryFor, embeddingEntry, isZdrEligible, type CatalogEntry } from "./catalog.ts";
import type {
  ConversationInput,
  EmbedInput,
  EmbeddingResult,
  GenerateInput,
  GenerateResult,
  InferencePort,
  StreamResult,
  TokenUsage,
} from "./port.ts";

// All firms share one gateway per environment. The control plane below is pinned on EVERY request via
// the AI binding's documented `gateway` options object (id/skipCache/collectLog/metadata) — NOT via
// cf-aig-* string headers, which are the REST-API surface the binding does not read. These options are
// the confidentiality and tenant-isolation guarantees the InferencePort promises, realized as gateway
// controls the interface never names.
export const GATEWAY_ID = "magna-carta-inference";

// The exact object passed as { gateway } to env.AI.run. skipCache is pinned true (caching off);
// collectLog is pinned false (the binding's logging toggle is all-or-nothing — there is no payload-only
// option on the binding path — so we turn logging off outright; no prompt/response body is ever logged,
// and authoritative usage is read from the response, not the logs). No cacheKey is ever set.
export interface GatewayOptions {
  readonly id: string;
  readonly skipCache: true;
  readonly collectLog: false;
  readonly metadata: Record<string, string>;
}

// Firm metadata is DERIVED from the firm-scoped call context, never caller-supplied — the tag fails
// open (the request still runs, mis-metered) if omitted, so it must be structural here. Opaque ids only:
// the metadata is logged in cleartext, so it carries no client/matter text. The redundant model tag is
// dropped (model is already a native gateway log/spend dimension). Capped well under the 5-key gateway
// limit so a future matter_id key still fits.
export function deriveFirmMetadata(
  firmId: FirmId,
  slot: string,
  env: string,
): Record<string, string> {
  return { firm_id: firmId, slot, env };
}

// Caching off + logging off, on every firm-data request. The default cache key carries no firm
// dimension under shared Cloudflare-managed billing credentials, so a byte-identical prompt from two
// firms could collide — caching stays off, and no cacheKey is ever set (any future cache key MUST be
// firm-id-prefixed; see the firm-prefixed-cache-key fitness guard).
export function gatewayOptions(firmId: FirmId, slot: string, env: string): GatewayOptions {
  return {
    id: GATEWAY_ID,
    skipCache: true,
    collectLog: false,
    metadata: deriveFirmMetadata(firmId, slot, env),
  };
}

// The single caller-safe ZDR-ineligible problem literal. The category is "validation" (non-retryable):
// this is a LOCAL fail-closed policy refusal, not an upstream failure, so it must never be advertised as
// a retryable upstream error a caller would re-attempt. The detail is caller-safe text only — never the
// model id or any upstream body.
function zdrIneligibleProblem(): IntegrationProblem {
  return integrationProblem("validation", 400, "Model is not eligible for zero-data-retention", {
    detail:
      "The selected model is not zero-data-retention eligible and cannot process firm content.",
  });
}

type ZdrEntryResult =
  | { readonly ok: true; readonly entry: CatalogEntry }
  | { readonly ok: false; readonly problem: IntegrationProblem };

// Resolve a firm-selected reasoning model to its catalog entry, fail-closed: unknown or non-ZDR → a
// caller-safe problem. Centralizes the combined unknown/non-eligible check so both generate ops share
// one guard rather than repeating it inline.
function resolveZdrEntry(modelId: string): ZdrEntryResult {
  const entry = catalogEntryFor(modelId);
  if (entry === undefined || !entry.zdrEligible)
    return { ok: false, problem: zdrIneligibleProblem() };
  return { ok: true, entry };
}

// The fail-closed ZDR guard: before dispatch, assert the selected model is ZDR-eligible in the catalog.
// On a miss it returns the caller-safe problem above.
export function assertZdrEligible(modelId: string): IntegrationProblem | null {
  return isZdrEligible(modelId) ? null : zdrIneligibleProblem();
}

// AiBinding is a minimal structural type seam over the platform Ai binding so the pure package needs
// no @cloudflare/workers-types dependency. The worker provides the real binding at the composition root.
export interface AiBinding {
  run(model: string, input: unknown, options: { gateway: GatewayOptions }): Promise<unknown>;
}

export function zdrRejection<T>(modelId: string): Dispatch<T> {
  const problem = assertZdrEligible(modelId);
  // Only call this when a rejection is intended; a null here is a programming error, surfaced loud.
  if (problem === null) throw new Error("zdrRejection called for a ZDR-eligible model");
  return adapterError<T>(problem);
}

export interface GatewayPortOptions {
  readonly ai: AiBinding;
  // The deploy environment label that rides the firm metadata (e.g. "production"). Opaque to the gateway.
  readonly env: string;
}

// Reads the authoritative per-request usage from the inference response. The gateway routes to different
// providers (Workers AI native, Anthropic Messages, OpenAI-compatible), each using different field names:
// Anthropic uses input_tokens/output_tokens; Workers AI and OpenAI-compatible use prompt_tokens/
// completion_tokens. Both are read here so the parser is tolerant of whichever shape the gateway returns.
// Stays tolerant of an absent usage object (zeros), so a malformed response never throws on the
// metering path. The provider-native REQUEST-body translation and the live streaming-usage shape are
// pinned when the worker binding is wired in the composition root.
export function extractUsage(response: unknown): TokenUsage {
  const usage = (
    response as {
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        prompt_tokens?: number;
        completion_tokens?: number;
      };
    }
  ).usage;
  return {
    inputTokens: usage?.input_tokens ?? usage?.prompt_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? usage?.completion_tokens ?? 0,
  };
}

// Resolves the text content from the response across the shapes the gateway returns.
// Precedence: Workers AI native (response.response string) → Anthropic Messages
// (response.content[0].text) → OpenAI-compatible (response.choices[0].message.content) → "".
// Every access is guarded; the response is unknown and this function never throws.
function responseText(response: unknown): string {
  const r = response as Record<string, unknown>;
  // Workers AI native shape
  if (typeof r["response"] === "string") return r["response"];
  // Anthropic Messages shape
  const content = r["content"];
  if (Array.isArray(content) && content.length > 0) {
    const first = content[0] as Record<string, unknown>;
    if (typeof first["text"] === "string") return first["text"];
  }
  // OpenAI-compatible shape
  const choices = r["choices"];
  if (Array.isArray(choices) && choices.length > 0) {
    const message = (choices[0] as Record<string, unknown>)["message"];
    if (message !== null && typeof message === "object") {
      const msgContent = (message as Record<string, unknown>)["content"];
      if (typeof msgContent === "string") return msgContent;
    }
  }
  return "";
}

function responseVector(response: unknown): readonly number[] {
  const data = (response as { data?: number[][] }).data;
  return data?.[0] ?? [];
}

// Caller-safe failure mapping: a thrown gateway/model/network error becomes an adapter-error carrying a
// normalized problem. The detail is a fixed caller-safe string — the raw error (which can echo tokens or
// auth headers) is never spliced into it (it is reported through the standard redacting pipeline upstream).
// upstream/502 is retryable, so a transient gateway failure is re-attempted off the hot path.
function gatewayFailure<T>(): Dispatch<T> {
  return adapterError<T>(
    integrationProblem("upstream", 502, "Inference request failed", {
      detail: "The inference request could not be completed.",
    }),
  );
}

export function createGatewayInferencePort(options: GatewayPortOptions): InferencePort {
  const { ai, env } = options;

  async function runGenerate(input: GenerateInput): Promise<Dispatch<GenerateResult>> {
    // Fail-closed single lookup: reject both unknown and non-ZDR-eligible models with a caller-safe
    // non-retryable problem. zdrRejection is NOT used here — that function throws for ZDR-eligible
    // models and would create an uncaught-throw path if reached via a dead branch. Instead,
    // resolveZdrEntry combines the unknown/non-eligible check so the binding is never called on rejection.
    const resolved = resolveZdrEntry(input.modelId);
    if (!resolved.ok) return adapterError<GenerateResult>(resolved.problem);
    const entry = resolved.entry;
    const gateway = gatewayOptions(input.firmId, entry.slot, env);
    try {
      const response = await ai.run(input.modelId, { prompt: input.prompt }, { gateway });
      return ok({
        text: responseText(response),
        usage: extractUsage(response),
        snapshotId: entry.snapshotId,
      });
    } catch {
      return gatewayFailure<GenerateResult>();
    }
  }

  // The provider-native request body for a conversation. This translation is the ONLY new code on
  // this operation: the ZDR guard, the gateway options, the usage extraction, the response-text
  // reconciliation, and the caller-safe failure mapping are all the shipped ones, unchanged. The
  // system instruction rides its own top-level field rather than a message, exactly as it arrives on
  // ConversationInput, so the separation holds all the way to the wire; `member` maps to the
  // provider's `user` role here and nowhere else in the codebase.
  function conversationRequestBody(input: ConversationInput): unknown {
    return {
      system: input.systemPrompt,
      messages: input.messages.map((message) => ({
        role: message.role === "member" ? "user" : "assistant",
        content: message.content,
      })),
    };
  }

  return {
    generate: runGenerate,
    // A durable Workflow step invokes one operation per step; the buffered result shape matches generate.
    generateDurable: runGenerate,

    async generateConversation(input: ConversationInput): Promise<Dispatch<GenerateResult>> {
      // An empty conversation is a caller bug, not an upstream condition: there is nothing to answer,
      // and dispatching it would spend on a request whose result is meaningless. Refused before the
      // binding, with the same non-retryable category the other local refusal uses.
      if (input.messages.length === 0) {
        return adapterError<GenerateResult>(
          integrationProblem("validation", 400, "Conversation has no messages", {
            detail: "A conversation request must carry at least one message.",
          }),
        );
      }
      // The same fail-closed guard, in the same place, before dispatch: a non-eligible model returns
      // the caller-safe non-retryable problem and the binding is never called.
      const resolved = resolveZdrEntry(input.modelId);
      if (!resolved.ok) return adapterError<GenerateResult>(resolved.problem);
      const entry = resolved.entry;
      const gateway = gatewayOptions(input.firmId, entry.slot, env);
      try {
        const response = await ai.run(input.modelId, conversationRequestBody(input), { gateway });
        return ok({
          text: responseText(response),
          usage: extractUsage(response),
          snapshotId: entry.snapshotId,
        });
      } catch {
        return gatewayFailure<GenerateResult>();
      }
    },

    async generateStream(input): Promise<Dispatch<StreamResult>> {
      const resolved = resolveZdrEntry(input.modelId);
      if (!resolved.ok) return adapterError<StreamResult>(resolved.problem);
      const entry = resolved.entry;
      const gateway = gatewayOptions(input.firmId, entry.slot, env);
      try {
        const response = await ai.run(
          input.modelId,
          { prompt: input.prompt, stream: true },
          { gateway },
        );
        // The binding returns an async-iterable of text deltas under streaming; usage is read once the
        // stream completes (response-scanning stays off this path — buffering would defeat streaming).
        const stream = response as AsyncIterable<string>;
        // Definite-assignment assertion avoids the lint-flagged dead-initializer pattern while keeping
        // the same deferred-resolve semantics: resolveUsage is always assigned inside the Promise
        // constructor before relay() can call it.
        let resolveUsage!: (usage: TokenUsage) => void;
        const usage = new Promise<TokenUsage>((resolve) => {
          resolveUsage = resolve;
        });
        async function* relay(): AsyncIterable<string> {
          try {
            for await (const delta of stream) yield String(delta);
          } catch {
            // Normalize a mid-stream failure to a caller-safe error — never propagate the raw upstream
            // body (it can echo prompt/auth content past the caller-safe mapping).
            throw new Error("The inference stream failed.");
          } finally {
            // Usage always settles, so a consumer awaiting it never hangs after a mid-stream failure.
            resolveUsage(extractUsage(response));
          }
        }
        return ok({ stream: relay(), usage, snapshotId: entry.snapshotId });
      } catch {
        return gatewayFailure<StreamResult>();
      }
    },

    async embed(input: EmbedInput): Promise<Dispatch<EmbeddingResult>> {
      const entry = embeddingEntry();
      const gateway = gatewayOptions(input.firmId, entry.slot, env);
      try {
        const response = await ai.run(entry.modelId, { text: input.text }, { gateway });
        // Workers AI embeddings return { shape, data: number[][] }; data[0] is the vector for a
        // single-text embed. The documented embeddings response carries no usage object — embed
        // usage from the response is legitimately zero; it is not a parser gap.
        return ok({
          vector: responseVector(response),
          usage: extractUsage(response),
          snapshotId: entry.snapshotId,
        });
      } catch {
        return gatewayFailure<EmbeddingResult>();
      }
    },
  };
}
