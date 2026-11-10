import type { FirmId } from "@magna-carta/identifiers/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CATALOG,
  captioningEntry,
  PLATFORM_CAPTION_MODEL_ID,
  reasoningEntries,
} from "../src/catalog.ts";
import {
  CAPTION_STREAM_CLOSE_GRACE_MILLISECONDS,
  captionResultOf,
  createGatewayInferencePort,
  GATEWAY_ID,
  type AiBinding,
} from "../src/gateway.ts";
import type { CaptionResult } from "../src/port.ts";
import {
  createStubInferencePort,
  STUB_CAPTION_FINAL_EVERY_BYTES,
  STUB_RESPONSE_MARKER,
  STUB_SNAPSHOT_ID,
} from "../src/stub.ts";

// THE LIVE-CAPTION STREAM, both implementations of it.
//
// What would be a real failure if it stopped holding: the caption model is platform-fixed and off the
// roster a firm chooses from; the gateway opens the model's socket through the binding with the
// request pinned to exactly the audio the port promises (linear16, 48 kHz, one channel), interim
// answers on, the speaker never guessed by the model, the publisher's improvement programme refused,
// and the same confidentiality options every other operation sends; a refusal with no socket is a
// retryable upstream problem rather than a throw; answers are read as interim or final by the model's
// own flag; a close asks the model to finish and ends `closed`, while a socket that drops unasked ends
// `failed`; and the stub answers predictably from the bytes it is sent.

const FIRM = "firm_caption" as FirmId;

type Handler = (event: { data: unknown }) => void;

/** A socket in the shape the binding hands back, recording what is sent and letting a test answer. */
class FakeSocket {
  readonly sent: unknown[] = [];
  accepted = false;
  closedCount = 0;
  private readonly handlers = new Map<string, Handler[]>();

  accept(): void {
    this.accepted = true;
  }
  send(message: unknown): void {
    this.sent.push(message);
  }
  close(): void {
    this.closedCount += 1;
  }
  addEventListener(type: string, handler: Handler): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }
  /** The model says something. */
  answer(message: unknown): void {
    for (const handler of this.handlers.get("message") ?? []) {
      handler({ data: typeof message === "string" ? message : JSON.stringify(message) });
    }
  }
  /** The model, or the transport, closes the socket. */
  drop(): void {
    for (const handler of this.handlers.get("close") ?? []) handler({ data: undefined });
  }
}

function results(text: string, final: boolean) {
  return { type: "Results", channel: { alternatives: [{ transcript: text }] }, is_final: final };
}

function bindingAnswering(response: unknown) {
  const calls: Array<{ model: string; input: unknown; options: unknown }> = [];
  const ai: AiBinding = {
    async run(model, input, options) {
      calls.push({ model, input, options });
      return response;
    },
  };
  return { ai, calls };
}

async function openedWith(socket: FakeSocket) {
  const { ai, calls } = bindingAnswering({ webSocket: socket });
  const heard: CaptionResult[] = [];
  const ends: string[] = [];
  const port = createGatewayInferencePort({ ai, env: "test" });
  const dispatch = await port.openCaptionStream({
    firmId: FIRM,
    language: "en-GB",
    onResult: (result) => heard.push(result),
    onEnd: (outcome) => ends.push(outcome),
  });
  if (!dispatch.ok) throw new Error("the caption stream did not open");
  return { stream: dispatch.value, heard, ends, calls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the catalog's caption slot", () => {
  it("holds exactly one platform-fixed caption model, hosted on Cloudflare, off the firm roster", () => {
    expect(CATALOG.filter((entry) => entry.slot === "captioning")).toHaveLength(1);
    expect(captioningEntry().modelId).toBe(PLATFORM_CAPTION_MODEL_ID);
    expect(PLATFORM_CAPTION_MODEL_ID).toBe("@cf/deepgram/nova-3");
    expect(reasoningEntries().some((entry) => entry.modelId === PLATFORM_CAPTION_MODEL_ID)).toBe(
      false,
    );
  });
});

describe("the gateway's caption stream", () => {
  it("opens the model's socket through the binding with the pinned request and the same controls", async () => {
    const socket = new FakeSocket();
    const { calls } = await openedWith(socket);
    expect(socket.accepted).toBe(true);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.model).toBe(PLATFORM_CAPTION_MODEL_ID);
    expect(call.input).toEqual({
      encoding: "linear16",
      sample_rate: "48000",
      channels: "1",
      interim_results: "true",
      punctuate: "true",
      diarize: "false",
      mip_opt_out: "true",
      language: "en-GB",
    });
    const options = call.options as {
      gateway: { id: string; skipCache: boolean; collectLog: boolean; metadata: object };
      websocket: boolean;
    };
    expect(options.websocket).toBe(true);
    expect(options.gateway.id).toBe(GATEWAY_ID);
    expect(options.gateway.skipCache).toBe(true);
    expect(options.gateway.collectLog).toBe(false);
    expect(options.gateway.metadata).toEqual({ firm_id: FIRM, slot: "captioning", env: "test" });
  });

  it("answers a refusal that carries no socket as a retryable upstream problem", async () => {
    const { ai } = bindingAnswering(new Response("refused", { status: 400 }));
    const dispatch = await createGatewayInferencePort({ ai, env: "test" }).openCaptionStream({
      firmId: FIRM,
      onResult: () => {},
      onEnd: () => {},
    });
    expect(dispatch.ok).toBe(false);
    if (!dispatch.ok) {
      expect(dispatch.reason).toBe("adapter-error");
      expect(dispatch.problem?.category).toBe("upstream");
      expect(JSON.stringify(dispatch.problem)).not.toContain("refused");
    }
  });

  it("answers a thrown binding error as the same problem, never a throw", async () => {
    const ai: AiBinding = {
      async run() {
        throw new Error("the binding fell over");
      },
    };
    const dispatch = await createGatewayInferencePort({ ai, env: "test" }).openCaptionStream({
      firmId: FIRM,
      onResult: () => {},
      onEnd: () => {},
    });
    expect(dispatch.ok).toBe(false);
  });

  it("sends audio as binary, counts it, and reads interim and final answers", async () => {
    const socket = new FakeSocket();
    const { stream, heard } = await openedWith(socket);
    stream.sendAudio(new Uint8Array(1920));
    stream.sendAudio(new Uint8Array(1920));
    expect(socket.sent).toHaveLength(2);
    expect(stream.audioMillisecondsSent()).toBe(40);
    socket.answer(results("good morning", false));
    socket.answer(results("good morning everyone.", true));
    socket.answer({ type: "Metadata", duration: 1 });
    socket.answer("not json");
    expect(heard).toEqual([
      { text: "good morning", final: false },
      { text: "good morning everyone.", final: true },
    ]);
    expect(stream.modelId).toBe(PLATFORM_CAPTION_MODEL_ID);
  });

  it("keeps an idle stream alive with the model's own text message", async () => {
    const socket = new FakeSocket();
    const { stream } = await openedWith(socket);
    stream.keepAlive();
    expect(socket.sent).toEqual([JSON.stringify({ type: "KeepAlive" })]);
  });

  it("asks the model to finish on close, delivers what it answers, and ends closed", async () => {
    const socket = new FakeSocket();
    const { stream, heard, ends } = await openedWith(socket);
    stream.close();
    expect(socket.sent).toEqual([JSON.stringify({ type: "CloseStream" })]);
    // Nothing more is sent once the stream is closing.
    stream.sendAudio(new Uint8Array(10));
    expect(socket.sent).toHaveLength(1);
    socket.answer(results("thank you.", true));
    socket.drop();
    expect(heard).toEqual([{ text: "thank you.", final: true }]);
    expect(ends).toEqual(["closed"]);
  });

  it("closes the socket itself when the model never ends the stream", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const { stream, ends } = await openedWith(socket);
    stream.close();
    vi.advanceTimersByTime(CAPTION_STREAM_CLOSE_GRACE_MILLISECONDS);
    expect(ends).toEqual(["closed"]);
    expect(socket.closedCount).toBe(1);
  });

  it("ends failed, once, when the socket drops without being asked", async () => {
    const socket = new FakeSocket();
    const { stream, ends } = await openedWith(socket);
    socket.drop();
    socket.drop();
    stream.sendAudio(new Uint8Array(10));
    expect(ends).toEqual(["failed"]);
    expect(socket.sent).toHaveLength(0);
  });

  it("reads only the model's Results messages, with untrusted text never throwing", () => {
    expect(captionResultOf(JSON.stringify(results("  spaced  ", true)))).toEqual({
      text: "spaced",
      final: true,
    });
    expect(captionResultOf(JSON.stringify({ type: "SpeechStarted" }))).toBeNull();
    expect(captionResultOf(JSON.stringify({ type: "Results", channel: null }))).toBeNull();
    expect(captionResultOf(new Uint8Array(3))).toBeNull();
    expect(captionResultOf("{")).toBeNull();
  });
});

describe("the stub's caption stream", () => {
  it("answers each run of audio as an interim, and a stretch of one second as final", async () => {
    const heard: CaptionResult[] = [];
    const ends: string[] = [];
    const dispatch = await createStubInferencePort().openCaptionStream({
      firmId: FIRM,
      onResult: (result) => heard.push(result),
      onEnd: (outcome) => ends.push(outcome),
    });
    if (!dispatch.ok) throw new Error("the stub did not open");
    const stream = dispatch.value;
    expect(stream.modelId).toBe(STUB_SNAPSHOT_ID);
    stream.sendAudio(new Uint8Array(STUB_CAPTION_FINAL_EVERY_BYTES / 2));
    stream.sendAudio(new Uint8Array(STUB_CAPTION_FINAL_EVERY_BYTES / 2));
    stream.sendAudio(new Uint8Array(100));
    stream.close();
    stream.close();
    expect(heard).toEqual([
      { text: `${STUB_RESPONSE_MARKER} 48000 bytes of speech`, final: false },
      { text: `${STUB_RESPONSE_MARKER} 96000 bytes of speech`, final: true },
      { text: `${STUB_RESPONSE_MARKER} 100 bytes of speech`, final: false },
      { text: `${STUB_RESPONSE_MARKER} 100 bytes of speech`, final: true },
    ]);
    expect(ends).toEqual(["closed"]);
    expect(stream.audioMillisecondsSent()).toBe(1001);
  });
});
