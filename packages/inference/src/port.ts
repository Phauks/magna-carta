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
  // The most tokens the answer may hold. Optional, and sent as the provider's own answer-length field
  // when given: a caller whose answer has a known shape and size asks for room for it, because a
  // provider's default can be far shorter (Workers AI answers 256 tokens unless told otherwise) and an
  // answer cut short is an answer that cannot be read.
  // Every model hosted on Cloudflare is sent a length even when this is absent (the gateway's default,
  // ON_CLOUDFLARE_DEFAULT_MAXIMUM_OUTPUT_TOKENS), so no caller is cut at 256 tokens by forgetting it.
  readonly maximumOutputTokens?: number;
  // The answer must be one JSON object. A model hosted on Cloudflare is asked for it through its own
  // JSON mode, so a line in the conversation telling it to answer in prose cannot change the answer's
  // form; a third-party model is sent no such field on this path, and the caller's own strict reading
  // of the answer remains the guard there. Absent: the answer is prose.
  readonly answerFormat?: "json-object";
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

// LIVE CAPTIONS — speech to text while somebody is still speaking, platform-fixed like transcription:
// there is deliberately NO modelId field, for the transcript's reason. A caption is a display rather
// than a record, but which model heard a meeting is still the platform's decision and never a firm's.
//
// IT IS A STREAM, NOT A REQUEST. Audio is pushed as it arrives and words come back as the model hears
// them — first as INTERIM guesses that a later answer replaces, then as a FINAL answer for a stretch
// of speech that no later answer revises. The caller owns what happens to either; the port only
// carries them.
//
// THE AUDIO FORMAT IS FIXED BY THE PORT, not chosen per call: mono, 16-bit little-endian PCM at
// 48 kHz, which is exactly what a meeting's routing service delivers once its two channels are folded
// to one. Nothing is resampled on the way, so nothing is lost on the way.
export interface CaptionStreamInput {
  readonly firmId: FirmId;
  // A BCP-47 hint (e.g. "en", "en-GB"). Omitted, the model's own default language is used.
  readonly language?: string;
  // Every answer the model gives, in the order it gives them. Called synchronously from the socket's
  // own message event, so a slow handler holds up the next answer rather than reordering it.
  readonly onResult: (result: CaptionResult) => void;
  // Called once when the stream ends — `closed` when the caller closed it or the model finished after
  // being asked to, `failed` when the model or the transport dropped it unasked. Never called twice.
  readonly onEnd: (outcome: "closed" | "failed") => void;
}

export interface CaptionResult {
  // The words heard. Empty when the model reports silence, which a caller usually discards.
  readonly text: string;
  // True when the model will not revise this stretch of speech again; false for an interim guess
  // that the next answer for the same stretch replaces.
  readonly final: boolean;
}

export interface CaptionStream {
  // The platform-fixed caption model that is listening, for the same provenance reason a transcript
  // records its model.
  readonly modelId: InferenceModelId;
  // One run of audio in the port's fixed format. Safe to call at any rate; a stream that has ended
  // ignores it.
  sendAudio(samples: Uint8Array): void;
  // Tells the model the speaker is still there while no audio is flowing, so an idle stream is not
  // closed under the caller. Harmless while audio is flowing.
  keepAlive(): void;
  // Asks the model to finish: it answers anything still pending as final and then ends the stream,
  // which reaches `onEnd` as `closed`. Idempotent.
  close(): void;
  // How much audio this stream has been sent, in milliseconds of the port's fixed format — what a
  // caption is metered on, as a transcript is metered on the audio it sent.
  readonly audioMillisecondsSent: () => number;
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
  // The platform-fixed live-caption stream (no firm-selectable model). Answers once the stream is
  // open and accepting audio, or the problem that kept it from opening.
  openCaptionStream(input: CaptionStreamInput): Promise<Dispatch<CaptionStream>>;
}
