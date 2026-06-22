import type { FirmId } from "@magna-carta/identifiers/types";
import type { Dispatch } from "@magna-carta/integrations/dispatch";

// InferencePort is named in OUR domain vocabulary — never a vendor's API, never the gateway's. It is
// the single chokepoint every AI feature reaches a model through. Every operation returns a typed
// Dispatch: a model/provider/gateway failure becomes a first-class adapter-error carrying a normalized
// problem, never a bare throw. The reasoning model id is an explicit per-call parameter (read per call
// site through the firm-scoped data-access layer); it never rides on a connection or context object.

// A gateway-routable, provider-prefixed model id (e.g. "anthropic/claude-opus-4-8"). A bare id would
// not route through the gateway binding.
export type InferenceModelId = string;

// Authoritative per-request usage, captured from the inference RESPONSE (the provider usage object) —
// the durable billing source, never the gateway logs.
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

// firmId is carried so the implementation can derive the gateway firm-metadata tag and the per-firm
// spend dimension; callers pass the firm context they already hold, never a free-form metadata string.
export interface GenerateInput {
  readonly modelId: InferenceModelId;
  readonly prompt: string;
  readonly firmId: FirmId;
}

export interface GenerateResult {
  readonly text: string;
  readonly usage: TokenUsage;
  // The pinned model snapshot the run actually used — persisted per run for reproducibility.
  readonly snapshotId: string;
}

// Streaming generation for interactive drafting where first-token latency matters. The stream is an
// async iterable of text deltas; usage resolves once the stream completes, so the caller never buffers
// the whole response (buffering to scan it would defeat streaming).
export interface StreamResult {
  readonly stream: AsyncIterable<string>;
  readonly usage: Promise<TokenUsage>;
  readonly snapshotId: string;
}

// The embedding operation is platform-fixed: its model is a module constant pinned to the Vectorize
// index version. There is deliberately NO modelId field — per-firm embedding variation is
// unrepresentable in the signature, because a firm-swappable embedding model would invalidate the index.
export interface EmbedInput {
  readonly text: string;
  readonly firmId: FirmId;
}

export interface EmbeddingResult {
  readonly vector: readonly number[];
  readonly usage: TokenUsage;
  readonly snapshotId: string;
}

export interface InferencePort {
  // Buffered text generation (one value).
  generate(input: GenerateInput): Promise<Dispatch<GenerateResult>>;
  // Streaming text generation (token deltas + deferred usage).
  generateStream(input: GenerateInput): Promise<Dispatch<StreamResult>>;
  // A long/agentic run invoked one operation per step from a durable Workflow — the run state lives in
  // the Workflow, not the port. The result shape matches generate; a Workflow step calls this per step.
  generateDurable(input: GenerateInput): Promise<Dispatch<GenerateResult>>;
  // The platform-fixed embedding operation (no firm-selectable model).
  embed(input: EmbedInput): Promise<Dispatch<EmbeddingResult>>;
}
