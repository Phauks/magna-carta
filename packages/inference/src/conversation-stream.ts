import type { TokenUsage } from "./port.ts";

// Reads a streamed conversation answer from a third-party model: the Messages event stream, as
// server-sent events, that the gateway binding relays when a request carries `stream: true`.
//
// Two things are collected from it. The answer is every `text_delta`, in order. The thinking is every
// `thinking_delta`: the provider streams a readable SUMMARY of the model's reasoning when asked for one
// (`thinking.display: "summarized"`), never the raw reasoning, and the summary so far is handed to the
// caller as it grows so a reader can watch it arrive. A `signature_delta` (the provider's seal on a
// thinking block) and every other event are read past.
//
// Usage is read from `message_start` (the input count) and the last `message_delta` (the output
// count), which is where the event stream carries it.
//
// An `error` event mid-stream, or a stream that ends with no answer text, is a failure: the caller
// maps it to its own caller-safe problem, so no upstream body leaves this module. Nothing here logs.

export interface ConversationStreamResult {
  readonly text: string;
  readonly thinking: string;
  readonly usage: TokenUsage;
}

export class ConversationStreamError extends Error {}

type ThinkingListener = (thinkingSoFar: string) => void | Promise<void>;

// The bytes or strings a binding may hand back for a streamed request: a web ReadableStream (what the
// Workers binding returns), or any async iterable of chunks.
async function* chunksOf(body: unknown): AsyncIterable<string> {
  const decoder = new TextDecoder();
  const decode = (chunk: unknown): string =>
    typeof chunk === "string"
      ? chunk
      : chunk instanceof Uint8Array
        ? decoder.decode(chunk, { stream: true })
        : "";
  if (body !== null && typeof body === "object" && "getReader" in body) {
    const reader = (body as ReadableStream<unknown>).getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        yield decode(value);
      }
    } finally {
      reader.releaseLock();
    }
    return;
  }
  if (body !== null && typeof body === "object" && Symbol.asyncIterator in body) {
    for await (const chunk of body as AsyncIterable<unknown>) yield decode(chunk);
    return;
  }
  throw new ConversationStreamError("not a stream");
}

// Whether a binding's answer is a stream at all. A binding that ignores `stream: true` answers with
// the whole message, which the caller reads the buffered way.
export function isStreamBody(body: unknown): boolean {
  return (
    body !== null &&
    typeof body === "object" &&
    ("getReader" in body || Symbol.asyncIterator in body)
  );
}

// One server-sent event's JSON data, or null for a line that is not data (an `event:` name, a
// comment, a blank separator) or data that is not JSON (`[DONE]`).
function eventData(line: string): Record<string, unknown> | null {
  if (!line.startsWith("data:")) return null;
  const payload = line.slice("data:".length).trim();
  if (payload === "" || payload === "[DONE]") return null;
  try {
    const parsed: unknown = JSON.parse(payload);
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function numberAt(value: unknown, key: string): number | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const found = (value as Record<string, unknown>)[key];
  return typeof found === "number" ? found : undefined;
}

export async function readConversationStream(
  body: unknown,
  onThinking?: ThinkingListener,
): Promise<ConversationStreamResult> {
  let text = "";
  let thinking = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let buffered = "";

  const absorb = async (event: Record<string, unknown>): Promise<void> => {
    switch (event["type"]) {
      case "message_start": {
        const usage = (event["message"] as Record<string, unknown> | undefined)?.["usage"];
        inputTokens = numberAt(usage, "input_tokens") ?? inputTokens;
        outputTokens = numberAt(usage, "output_tokens") ?? outputTokens;
        return;
      }
      case "content_block_delta": {
        const delta = event["delta"] as Record<string, unknown> | undefined;
        if (delta?.["type"] === "text_delta" && typeof delta["text"] === "string") {
          text += delta["text"];
        } else if (delta?.["type"] === "thinking_delta" && typeof delta["thinking"] === "string") {
          thinking += delta["thinking"];
          if (onThinking !== undefined && delta["thinking"] !== "") await onThinking(thinking);
        }
        return;
      }
      case "message_delta": {
        outputTokens = numberAt(event["usage"], "output_tokens") ?? outputTokens;
        inputTokens = numberAt(event["usage"], "input_tokens") ?? inputTokens;
        return;
      }
      case "error":
        throw new ConversationStreamError("the stream reported an error");
      default:
        // A Workers AI native frame carries its text as `response`; read it the same way, so a
        // model answering in that shape still answers.
        if (typeof event["response"] === "string") text += event["response"];
    }
  };

  for await (const chunk of chunksOf(body)) {
    buffered += chunk;
    let newline = buffered.indexOf("\n");
    while (newline !== -1) {
      const line = buffered.slice(0, newline).replace(/\r$/, "");
      buffered = buffered.slice(newline + 1);
      const event = eventData(line);
      if (event !== null) await absorb(event);
      newline = buffered.indexOf("\n");
    }
  }
  const last = eventData(buffered.trim());
  if (last !== null) await absorb(last);

  if (text === "") throw new ConversationStreamError("the stream carried no answer");
  return { text, thinking, usage: { inputTokens, outputTokens } };
}
