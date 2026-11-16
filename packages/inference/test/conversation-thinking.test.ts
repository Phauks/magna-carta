import type { FirmId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { readConversationStream } from "../src/conversation-stream.ts";
import { createGatewayInferencePort, type AiBinding } from "../src/gateway.ts";
import { createStubInferencePort, STUB_RESPONSE_MARKER } from "../src/stub.ts";

const FIRM = "firm_t" as FirmId;

function sse(...events: readonly Record<string, unknown>[]): string {
  return events
    .map((event) => `event: ${String(event["type"])}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
}

const STREAM = sse(
  { type: "message_start", message: { usage: { input_tokens: 31, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
  {
    type: "content_block_delta",
    index: 0,
    delta: { type: "thinking_delta", thinking: "Reading the order. " },
  },
  {
    type: "content_block_delta",
    index: 0,
    delta: { type: "thinking_delta", thinking: "Checking the deadline." },
  },
  {
    type: "content_block_delta",
    index: 0,
    delta: { type: "signature_delta", signature: "sealed" },
  },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "You can amend " } },
  { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "until May 1." } },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 57 } },
  { type: "message_stop" },
);

// The bytes cut at arbitrary points, the way a network delivers them, so a line split across two
// chunks is read whole.
function byteStream(text: string, chunkSize: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

describe("reading a streamed answer and its thinking", () => {
  it("collects the answer, the thinking summary and the usage, across split chunks", async () => {
    const heard: string[] = [];
    const result = await readConversationStream(byteStream(STREAM, 7), (thinking) => {
      heard.push(thinking);
    });
    expect(result.text).toBe("You can amend until May 1.");
    expect(result.thinking).toBe("Reading the order. Checking the deadline.");
    expect(result.usage).toEqual({ inputTokens: 31, outputTokens: 57 });
    expect(heard).toEqual(["Reading the order. ", "Reading the order. Checking the deadline."]);
  });

  it("fails on an error event rather than settling a partial answer", async () => {
    const broken =
      sse({ type: "content_block_delta", delta: { type: "text_delta", text: "Half an" } }) +
      sse({ type: "error", error: { type: "overloaded_error", message: "upstream words" } });
    await expect(readConversationStream(byteStream(broken, 64))).rejects.toThrow(
      "the stream reported an error",
    );
  });

  it("fails on a stream that carried no answer", async () => {
    const empty = sse({ type: "message_start", message: { usage: { input_tokens: 3 } } });
    await expect(readConversationStream(byteStream(empty, 64))).rejects.toThrow(
      "the stream carried no answer",
    );
  });
});

describe("asking a third-party model for its thinking", () => {
  it("streams the request with a summarized thinking display, and reads the stream back", async () => {
    const calls: unknown[] = [];
    const ai: AiBinding = {
      async run(_model, input) {
        calls.push(input);
        return byteStream(STREAM, 50);
      },
    };
    const port = createGatewayInferencePort({ ai, env: "production" });
    const heard: string[] = [];
    const result = await port.generateConversation({
      modelId: "anthropic/claude-opus-5-5",
      firmId: FIRM,
      systemPrompt: "system",
      messages: [{ role: "member", content: "can I amend" }],
      onThinking: (thinking) => {
        heard.push(thinking);
      },
    });
    expect(calls[0]).toMatchObject({
      stream: true,
      thinking: { type: "adaptive", display: "summarized" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe("You can amend until May 1.");
      expect(result.value.usage).toEqual({ inputTokens: 31, outputTokens: 57 });
    }
    expect(heard.at(-1)).toBe("Reading the order. Checking the deadline.");
  });

  it("asks for no stream when nothing listens, and reads the text after a thinking block", async () => {
    const calls: unknown[] = [];
    const ai: AiBinding = {
      async run(_model, input) {
        calls.push(input);
        return {
          content: [
            { type: "thinking", thinking: "", signature: "sealed" },
            { type: "text", text: "The answer." },
          ],
          usage: { input_tokens: 4, output_tokens: 2 },
        };
      },
    };
    const port = createGatewayInferencePort({ ai, env: "production" });
    const result = await port.generateConversation({
      modelId: "anthropic/claude-opus-5-5",
      firmId: FIRM,
      systemPrompt: "system",
      messages: [{ role: "member", content: "a question" }],
    });
    expect(calls[0]).not.toHaveProperty("stream");
    expect(calls[0]).not.toHaveProperty("thinking");
    expect(result.ok && result.value.text).toBe("The answer.");
  });

  it("maps a stream that fails part way to the caller-safe gateway failure", async () => {
    const ai: AiBinding = {
      async run() {
        return byteStream(sse({ type: "error", error: { message: "upstream words" } }), 64);
      },
    };
    const port = createGatewayInferencePort({ ai, env: "production" });
    const result = await port.generateConversation({
      modelId: "anthropic/claude-opus-5-5",
      firmId: FIRM,
      systemPrompt: "system",
      messages: [{ role: "member", content: "a question" }],
      onThinking: () => undefined,
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("upstream words");
  });
});

describe("the stub's thinking", () => {
  it("tells a listener one deterministic summary", async () => {
    const heard: string[] = [];
    await createStubInferencePort().generateConversation({
      modelId: "anthropic/claude-opus-5-5",
      firmId: FIRM,
      systemPrompt: "system",
      messages: [{ role: "member", content: "hello" }],
      onThinking: (thinking) => {
        heard.push(thinking);
      },
    });
    expect(heard).toEqual([`${STUB_RESPONSE_MARKER} thinking about: hello`]);
  });
});
