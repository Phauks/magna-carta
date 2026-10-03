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

// A conversation's speakers, in OUR vocabulary — never a vendor's role names. The adapter maps these
// onto whatever the provider calls them, beside the response-shape reconciliation it already does.
// There is deliberately no "system" member: the platform-authored instruction travels on its own
// field (below), so nothing a member types can occupy that role.
export type ConversationRole = "member" | "assistant";

export interface ConversationMessage {
  readonly role: ConversationRole;
  readonly content: string;
}

// A multi-turn conversation request. The role boundary between what the member said and what the
// model previously answered is load-bearing, not decoration: a model that cannot tell them apart can
// be steered by its own prior output, and a transcript concatenated into one string is the shape that
// lets pasted text act as instruction. Hence a message array rather than a flattened prompt, and one
// added operation rather than a polymorphic prompt every implementation and every double would have
// to handle twice over.
export interface ConversationInput {
  readonly modelId: InferenceModelId;
  readonly firmId: FirmId;
  // Platform-authored, never member-authored, never firm-authored. Structurally separate from the
  // conversation because it is the one part of the request the firm did not write — a reviewer can
  // see at a glance which bytes are platform text and which are firm content.
  readonly systemPrompt: string;
  readonly messages: readonly ConversationMessage[];
}

// Speech to text, platform-fixed like embedding: there is deliberately NO modelId field. A firm does
// not choose its speech model, because a transcript's fidelity is a property of the record rather
// than a preference, and two firms' transcripts of the same audio should differ only in the audio.
export interface TranscribeInput {
  // A complete WAV file: mono, 16-bit PCM, 16 kHz. The whole file, header included, because the
  // provider decodes the container itself and a bare PCM body carries no rate to decode it at.
  readonly audio: Uint8Array;
  readonly firmId: FirmId;
  // A BCP-47 hint (e.g. "en", "en-GB"). Omitted lets the model detect the language itself.
  readonly language?: string;
  // The tail of the previous chunk's text, so the model keeps context across a cut it did not choose.
  readonly initialPrompt?: string;
}

export interface TranscriptionSegment {
  // Offsets within THIS audio, in seconds. Placing a segment on a meeting's timeline is the caller's
  // job: only the caller knows where in the meeting this audio was cut from.
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly text: string;
}

export interface TranscriptionResult {
  // The platform-fixed transcription model that produced the text — recorded per transcript for the
  // same reason a generation records its snapshot: a transcript is discoverable work product, and
  // which model heard the audio is part of what it says.
  readonly modelId: InferenceModelId;
  readonly text: string;
  // The language the model reports having transcribed, or null when it reports none.
  readonly language: string | null;
  // Chronological, possibly empty: a provider response with no segment timings yields an empty list
  // rather than a timing invented to fill it.
  readonly segments: readonly TranscriptionSegment[];
  // The duration of the audio, which is what transcription is metered on (per audio minute) where
  // generation is metered on tokens.
  readonly audioSeconds: number;
}

export interface InferencePort {
  // Buffered text generation (one value).
  generate(input: GenerateInput): Promise<Dispatch<GenerateResult>>;
  // Buffered generation over a multi-turn conversation. The result shape is GenerateResult
  // unchanged, so metering, provenance, and the Dispatch error taxonomy all apply without a second
  // shape to keep in step.
  generateConversation(input: ConversationInput): Promise<Dispatch<GenerateResult>>;
  // Streaming text generation (token deltas + deferred usage).
  generateStream(input: GenerateInput): Promise<Dispatch<StreamResult>>;
  // A long/agentic run invoked one operation per step from a durable Workflow — the run state lives in
  // the Workflow, not the port. The result shape matches generate; a Workflow step calls this per step.
  generateDurable(input: GenerateInput): Promise<Dispatch<GenerateResult>>;
  // The platform-fixed embedding operation (no firm-selectable model).
  embed(input: EmbedInput): Promise<Dispatch<EmbeddingResult>>;
  // The platform-fixed speech-to-text operation (no firm-selectable model).
  transcribe(input: TranscribeInput): Promise<Dispatch<TranscriptionResult>>;
}
