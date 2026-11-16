import { ok, type Dispatch } from "@magna-carta/integrations/dispatch";
import type {
  CaptionStream,
  CaptionStreamInput,
  ConversationInput,
  EmbedInput,
  EmbeddingResult,
  GenerateInput,
  GenerateResult,
  InferencePort,
  StreamResult,
  TranscribeInput,
  TranscriptionResult,
} from "./port.ts";
import { wavAudioSeconds } from "./wav-duration.ts";

// A complete, deterministic InferencePort that reaches NO provider.
//
// It lives here rather than in any one feature because it is not a test double for a single caller:
// it is a general implementation of the port, and every AI feature the platform builds gets it for
// free. Two things follow from that, and both are the reason it exists.
//
// The fail-safe direction is structural. The composition root resolves the gateway port only when the
// binding AND the enabling configuration are present, and resolves THIS otherwise — the same
// absent-resolves-to-safe shape the scan port, the conversion engine port, and the flag evaluator all
// take. A misconfigured environment therefore produces obviously-fake answers, never real spend on a
// path nobody intended.
//
// And a whole feature — routes, consent gates, queue, batches, audit, metering, transport, ceilings —
// is testable end to end with no credentials and no spend, which is what lets that work merge before
// the provider-side decisions it does not depend on are made.
//
// Determinism is the contract: no network, no binding, no randomness, no clock. Identical input
// yields byte-identical output, so a metering assertion or a transcript assertion is meaningful.

// The pinned snapshot every stub result reports. A recorded provenance of "stub" is unmistakable in a
// turn row a year later — nobody mistakes it for a model version.
export const STUB_SNAPSHOT_ID = "stub";

// A marker every stub completion opens with, so a caller reading a transcript (or a test reading a
// pushed frame) can tell at a glance that no model was involved.
export const STUB_RESPONSE_MARKER = "[stub inference]";

// THE STUB'S CAPTION RHYTHM: every run of audio it is sent is answered at once with an interim guess
// naming how much audio it has heard in the current stretch, and a stretch becomes FINAL each time it
// reaches one second of the port's format (96,000 bytes of mono 16-bit at 48 kHz) — so a consumer test
// can predict exactly which answers a given run of audio produces, with no clock involved.
export const STUB_CAPTION_FINAL_EVERY_BYTES = 96_000;

// Deterministic, non-zero usage derived from the input length. Non-zero matters: a metering test over
// a stub-backed run has to be able to fail. Derived rather than constant so two different requests do
// not meter identically and hide a key mix-up.
function stubUsage(
  inputText: string,
  outputText: string,
): { inputTokens: number; outputTokens: number } {
  return {
    inputTokens: inputText.length + 1,
    outputTokens: outputText.length + 1,
  };
}

function stubResult(inputText: string, outputText: string): GenerateResult {
  return {
    text: outputText,
    usage: stubUsage(inputText, outputText),
    snapshotId: STUB_SNAPSHOT_ID,
  };
}

export function createStubInferencePort(): InferencePort {
  async function generate(input: GenerateInput): Promise<Dispatch<GenerateResult>> {
    return ok(stubResult(input.prompt, `${STUB_RESPONSE_MARKER} ${input.prompt}`));
  }

  return {
    generate,
    generateDurable: generate,

    // Echoes the marker plus the LAST member message, so a test can assert that the window the
    // consumer built actually reached the port rather than that something reached it.
    async generateConversation(input: ConversationInput): Promise<Dispatch<GenerateResult>> {
      // The ZDR guard is deliberately NOT applied here. The stub reaches no provider, so refusing on
      // eligibility would test nothing — and worse, a suite that saw the stub refuse would be
      // exercising a guard that lives somewhere else, hiding a real failure of the gateway port's own
      // fail-closed check.
      let lastMemberMessage = "";
      for (const message of input.messages) {
        if (message.role === "member") lastMemberMessage = message.content;
      }
      const promptText = input.systemPrompt + lastMemberMessage;
      // A listener for the thinking is told one deterministic summary, so a local run and a consumer
      // test both see the thinking path work without a provider.
      if (input.onThinking !== undefined) {
        await input.onThinking(`${STUB_RESPONSE_MARKER} thinking about: ${lastMemberMessage}`);
      }
      return ok(stubResult(promptText, `${STUB_RESPONSE_MARKER} ${lastMemberMessage}`));
    },

    async generateStream(input: GenerateInput): Promise<Dispatch<StreamResult>> {
      const text = `${STUB_RESPONSE_MARKER} ${input.prompt}`;
      const usage = stubUsage(input.prompt, text);
      async function* deltas(): AsyncIterable<string> {
        yield text;
      }
      return ok({
        stream: deltas(),
        usage: Promise.resolve(usage),
        snapshotId: STUB_SNAPSHOT_ID,
      });
    },

    async embed(input: EmbedInput): Promise<Dispatch<EmbeddingResult>> {
      // A fixed-width vector of values derived from the text: same text, same vector, and two
      // different texts do not collide.
      const vector = Array.from({ length: 8 }, (_unused, index) => {
        const code = input.text.charCodeAt(index % Math.max(input.text.length, 1));
        return Number.isNaN(code) ? 0 : (code % 100) / 100;
      });
      return ok({
        vector,
        usage: stubUsage(input.text, ""),
        snapshotId: STUB_SNAPSHOT_ID,
      });
    },

    // An open stream that answers from the audio alone — see STUB_CAPTION_FINAL_EVERY_BYTES. A close
    // answers whatever the current stretch holds as final, as the real model does on its close message,
    // and then ends the stream `closed`; a stream that has ended ignores everything.
    async openCaptionStream(input: CaptionStreamInput): Promise<Dispatch<CaptionStream>> {
      let stretchBytes = 0;
      let totalBytes = 0;
      let ended = false;
      const words = (bytes: number) => `${STUB_RESPONSE_MARKER} ${bytes} bytes of speech`;
      return ok({
        modelId: STUB_SNAPSHOT_ID,
        sendAudio(samples: Uint8Array): void {
          if (ended || samples.byteLength === 0) return;
          totalBytes += samples.byteLength;
          stretchBytes += samples.byteLength;
          if (stretchBytes >= STUB_CAPTION_FINAL_EVERY_BYTES) {
            input.onResult({ text: words(stretchBytes), final: true });
            stretchBytes = 0;
          } else {
            input.onResult({ text: words(stretchBytes), final: false });
          }
        },
        keepAlive(): void {},
        close(): void {
          if (ended) return;
          ended = true;
          if (stretchBytes > 0) input.onResult({ text: words(stretchBytes), final: true });
          stretchBytes = 0;
          input.onEnd("closed");
        },
        audioMillisecondsSent: () => Math.floor(totalBytes / 96),
      });
    },

    // One segment spanning the whole audio, its text naming the audio's size, so a consumer test can
    // predict the transcript from the bytes it sent: `[stub inference] <n> bytes of audio`, over
    // [0, playing time read from the WAV header]. The language echoes the hint, or null without one.
    // The model id is "stub", like every other stub result's provenance: a transcript recorded in an
    // environment that resolved to this port must never read as one a real model heard.
    async transcribe(input: TranscribeInput): Promise<Dispatch<TranscriptionResult>> {
      const audioSeconds = wavAudioSeconds(input.audio);
      const text = `${STUB_RESPONSE_MARKER} ${input.audio.byteLength} bytes of audio`;
      return ok({
        modelId: STUB_SNAPSHOT_ID,
        text,
        language: input.language ?? null,
        segments: [{ startSeconds: 0, endSeconds: audioSeconds, text }],
        audioSeconds,
      });
    },
  };
}
