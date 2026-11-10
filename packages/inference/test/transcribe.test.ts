import type { FirmId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { PLATFORM_TRANSCRIPTION_MODEL_ID, transcriptionEntry } from "../src/catalog.ts";
import { createGatewayInferencePort, GATEWAY_ID, type AiBinding } from "../src/gateway.ts";
import { createStubInferencePort, STUB_RESPONSE_MARKER, STUB_SNAPSHOT_ID } from "../src/stub.ts";
import { wavAudioSeconds } from "../src/wav-duration.ts";

const FIRM = "firm_t" as FirmId;

// A canonical WAV in the format the port documents: mono, 16-bit PCM, 16 kHz, so 32,000 bytes a
// second. The samples are a ramp rather than silence so the base64 assertion compares real bytes.
function wavFile(seconds: number): Uint8Array {
  const sampleRate = 16_000;
  const byteRate = sampleRate * 2;
  const dataBytes = Math.round(seconds * byteRate);
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      bytes[offset + index] = text.charCodeAt(index);
    }
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let index = 44; index < bytes.length; index += 1) bytes[index] = index % 251;
  return bytes;
}

function fakeAi(response: unknown): {
  ai: AiBinding;
  calls: Array<{ model: string; input: unknown; options: unknown }>;
} {
  const calls: Array<{ model: string; input: unknown; options: unknown }> = [];
  return {
    calls,
    ai: {
      async run(model, input, options) {
        calls.push({ model, input, options });
        return response;
      },
    },
  };
}

// The body of the one binding call, failing loudly when the binding was never reached.
function firstInput(calls: ReadonlyArray<{ input: unknown }>): Record<string, unknown> {
  const call = calls[0];
  if (call === undefined) throw new Error("the binding was not called");
  return call.input as Record<string, unknown>;
}

function throwingAi(error: unknown): { ai: AiBinding; calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    ai: {
      async run() {
        calls.push(1);
        throw error;
      },
    },
  };
}

// A response in the documented output shape, trimmed to the fields the adapter reads plus a few it
// deliberately ignores.
const DOCUMENTED_RESPONSE = {
  text: " The deposition is adjourned to Thursday. ",
  word_count: 6,
  vtt: "WEBVTT\n\n00:00.000 --> 00:02.400\nThe deposition is adjourned to Thursday.",
  transcription_info: {
    language: "en",
    language_probability: 0.98,
    duration: 2.5,
    duration_after_vad: 2.4,
  },
  segments: [
    {
      start: 0,
      end: 1.2,
      text: " The deposition is adjourned",
      temperature: 0,
      avg_logprob: -0.2,
      compression_ratio: 1.1,
      no_speech_prob: 0.01,
      words: [{ word: "The", start: 0, end: 0.2 }],
    },
    { start: 1.2, end: 2.4, text: " to Thursday." },
  ],
};

describe("the transcription catalog slot", () => {
  it("is platform-fixed to the one Workers AI speech model", () => {
    expect(transcriptionEntry().slot).toBe("transcription");
    expect(transcriptionEntry().modelId).toBe("@cf/openai/whisper-large-v3-turbo");
    expect(transcriptionEntry().modelId).toBe(PLATFORM_TRANSCRIPTION_MODEL_ID);
    expect(transcriptionEntry().zdrEligible).toBe(true);
    expect(transcriptionEntry().noTrainingEligible).toBe(true);
  });
});

describe("transcribe on the gateway port — the request built for Workers AI", () => {
  it("sends the documented fields through the same gateway control plane as every operation", async () => {
    const { ai, calls } = fakeAi(DOCUMENTED_RESPONSE);
    const port = createGatewayInferencePort({ ai, env: "production" });
    const audio = wavFile(0.5);
    await port.transcribe({
      audio,
      firmId: FIRM,
      language: "en-GB",
      initialPrompt: "the witness said",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe("@cf/openai/whisper-large-v3-turbo");
    expect(calls[0]?.input).toEqual({
      audio: Buffer.from(audio).toString("base64"),
      task: "transcribe",
      vad_filter: false,
      language: "en",
      initial_prompt: "the witness said",
    });
    const options = calls[0]?.options as {
      gateway: {
        id: string;
        skipCache: boolean;
        collectLog: boolean;
        metadata: Record<string, string>;
      };
    };
    // The four confidentiality fields come from the one function every operation shares.
    expect(options.gateway.id).toBe(GATEWAY_ID);
    expect(options.gateway.skipCache).toBe(true);
    expect(options.gateway.collectLog).toBe(false);
    expect(options.gateway.metadata).toEqual({
      firm_id: FIRM,
      slot: "transcription",
      env: "production",
    });
  });

  it("omits language and initial_prompt when there is no hint, so the model detects", async () => {
    const { ai, calls } = fakeAi(DOCUMENTED_RESPONSE);
    const port = createGatewayInferencePort({ ai, env: "production" });
    await port.transcribe({ audio: wavFile(0.1), firmId: FIRM });
    const body = firstInput(calls);
    expect(body).not.toHaveProperty("language");
    expect(body).not.toHaveProperty("initial_prompt");
    expect(body["task"]).toBe("transcribe");
  });

  it("sends the primary subtag of a BCP-47 hint and drops a malformed one", async () => {
    const languageSent = async (language: string): Promise<unknown> => {
      const { ai, calls } = fakeAi(DOCUMENTED_RESPONSE);
      await createGatewayInferencePort({ ai, env: "production" }).transcribe({
        audio: wavFile(0.1),
        firmId: FIRM,
        language,
      });
      return firstInput(calls)["language"];
    };
    expect(await languageSent("fr")).toBe("fr");
    expect(await languageSent("zh-Hant-TW")).toBe("zh");
    expect(await languageSent("EN_us")).toBe("en");
    expect(await languageSent("haw")).toBe("haw");
    expect(await languageSent("")).toBeUndefined();
    expect(await languageSent("english")).toBeUndefined();
  });

  it("omits a blank initial prompt rather than sending whitespace as context", async () => {
    const { ai, calls } = fakeAi(DOCUMENTED_RESPONSE);
    await createGatewayInferencePort({ ai, env: "production" }).transcribe({
      audio: wavFile(0.1),
      firmId: FIRM,
      initialPrompt: "   ",
    });
    expect(firstInput(calls)).not.toHaveProperty("initial_prompt");
  });

  it("encodes a multi-megabyte chunk without overflowing the call stack", async () => {
    const { ai, calls } = fakeAi(DOCUMENTED_RESPONSE);
    const audio = wavFile(31);
    await createGatewayInferencePort({ ai, env: "production" }).transcribe({
      audio,
      firmId: FIRM,
    });
    expect(firstInput(calls)["audio"]).toBe(Buffer.from(audio).toString("base64"));
  });
});

describe("transcribe on the gateway port — the response mapping", () => {
  it("maps the documented output onto the port's result", async () => {
    const { ai } = fakeAi(DOCUMENTED_RESPONSE);
    const result = await createGatewayInferencePort({ ai, env: "production" }).transcribe({
      audio: wavFile(2.5),
      firmId: FIRM,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        modelId: "@cf/openai/whisper-large-v3-turbo",
        text: "The deposition is adjourned to Thursday.",
        language: "en",
        segments: [
          { startSeconds: 0, endSeconds: 1.2, text: "The deposition is adjourned" },
          { startSeconds: 1.2, endSeconds: 2.4, text: "to Thursday." },
        ],
        audioSeconds: 2.5,
      },
    });
  });

  it("yields no segments when the response carries none, keeping the text", async () => {
    const { ai } = fakeAi({ text: "Objection." });
    const result = await createGatewayInferencePort({ ai, env: "production" }).transcribe({
      audio: wavFile(1.5),
      firmId: FIRM,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe("Objection.");
      expect(result.value.segments).toEqual([]);
      expect(result.value.language).toBeNull();
      // No provider duration: the WAV header's playing time, never zero for audio that was sent.
      expect(result.value.audioSeconds).toBe(1.5);
    }
  });

  it("drops a segment missing its timing or text rather than inventing one", async () => {
    const { ai } = fakeAi({
      text: "a b c",
      segments: [
        { start: 0, end: 1, text: " a" },
        { start: 1, text: " b" },
        { start: "2", end: 3, text: " c" },
        { start: 3, end: 4 },
        null,
        { start: 4, end: 5, text: " d" },
      ],
    });
    const result = await createGatewayInferencePort({ ai, env: "production" }).transcribe({
      audio: wavFile(5),
      firmId: FIRM,
    });
    expect(result.ok && result.value.segments).toEqual([
      { startSeconds: 0, endSeconds: 1, text: "a" },
      { startSeconds: 4, endSeconds: 5, text: "d" },
    ]);
  });

  it("never throws on a response that is not the documented shape", async () => {
    const responses: unknown[] = [null, undefined, "text", 42, { segments: "nope" }];
    const results = await Promise.all(
      responses.map((response) =>
        createGatewayInferencePort({ ai: fakeAi(response).ai, env: "production" }).transcribe({
          audio: wavFile(0.25),
          firmId: FIRM,
        }),
      ),
    );
    for (const result of results) {
      expect(result).toEqual({
        ok: true,
        value: {
          modelId: "@cf/openai/whisper-large-v3-turbo",
          text: "",
          language: null,
          segments: [],
          audioSeconds: 0.25,
        },
      });
    }
  });
});

describe("transcribe on the gateway port — failures", () => {
  it("maps a thrown binding error to the retryable upstream problem, with a caller-safe detail", async () => {
    const { ai } = throwingAi(new Error("upstream said: Bearer secret-token, audio=..."));
    const result = await createGatewayInferencePort({ ai, env: "production" }).transcribe({
      audio: wavFile(0.5),
      firmId: FIRM,
    });
    if (result.ok) throw new Error("expected an adapter error");
    expect(result.reason).toBe("adapter-error");
    expect(result.problem?.category).toBe("upstream");
    expect(result.problem?.status).toBe(502);
    expect(result.problem?.retryable).toBe(true);
    expect(result.problem?.detail).toBe("The inference request could not be completed.");
    expect(JSON.stringify(result.problem)).not.toContain("secret-token");
  });

  it("refuses empty audio before the binding, as a non-retryable validation problem", async () => {
    const { ai, calls } = throwingAi(new Error("must not be reached"));
    const result = await createGatewayInferencePort({ ai, env: "production" }).transcribe({
      audio: new Uint8Array(0),
      firmId: FIRM,
    });
    expect(calls).toHaveLength(0);
    if (result.ok) throw new Error("expected an adapter error");
    expect(result.reason).toBe("adapter-error");
    expect(result.problem?.category).toBe("validation");
    expect(result.problem?.status).toBe(400);
    expect(result.problem?.retryable).toBe(false);
  });
});

describe("transcribe on the stub port", () => {
  it("returns one deterministic segment spanning the audio, its text naming the audio's size", async () => {
    const port = createStubInferencePort();
    const audio = wavFile(3);
    const first = await port.transcribe({ audio, firmId: FIRM, language: "en" });
    const second = await port.transcribe({ audio, firmId: FIRM, language: "en" });
    const text = `${STUB_RESPONSE_MARKER} ${audio.byteLength} bytes of audio`;
    expect(first).toEqual({
      ok: true,
      value: {
        modelId: STUB_SNAPSHOT_ID,
        text,
        language: "en",
        segments: [{ startSeconds: 0, endSeconds: 3, text }],
        audioSeconds: 3,
      },
    });
    expect(second).toEqual(first);
  });

  it("reports no language without a hint, and different audio yields different text", async () => {
    const port = createStubInferencePort();
    const short = await port.transcribe({ audio: wavFile(1), firmId: FIRM });
    const long = await port.transcribe({ audio: wavFile(2), firmId: FIRM });
    expect(short.ok && short.value.language).toBeNull();
    expect(short.ok && long.ok && short.value.text !== long.value.text).toBe(true);
  });
});

describe("the WAV playing-time reader", () => {
  it("reads the data length over the byte rate", () => {
    expect(wavAudioSeconds(wavFile(2))).toBe(2);
    expect(wavAudioSeconds(wavFile(0.5))).toBe(0.5);
  });

  it("walks past a chunk between fmt and data", () => {
    const plain = wavFile(1);
    const extra = new Uint8Array([
      ..."LIST".split("").map((c) => c.charCodeAt(0)),
      3,
      0,
      0,
      0,
      1,
      2,
      3,
      0,
    ]);
    const withList = new Uint8Array(plain.length + extra.length);
    withList.set(plain.subarray(0, 36), 0);
    withList.set(extra, 36);
    withList.set(plain.subarray(36), 36 + extra.length);
    expect(wavAudioSeconds(withList)).toBe(1);
  });

  it("bounds an unset or overstated data size by the bytes present", () => {
    const audio = wavFile(1);
    new DataView(audio.buffer).setUint32(40, 0xffffffff, true);
    expect(wavAudioSeconds(audio)).toBe(1);
  });

  it("is zero for anything that is not a readable WAV", () => {
    expect(wavAudioSeconds(new Uint8Array(0))).toBe(0);
    expect(wavAudioSeconds(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]))).toBe(0);
  });
});
