import { describe, expect, it, vi } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { PLATFORM_ON_CLOUDFLARE_REASONING_MODEL_ID } from "../src/catalog.ts";
import {
  createGatewayInferencePort,
  GATEWAY_ID,
  ON_CLOUDFLARE_DEFAULT_MAXIMUM_OUTPUT_TOKENS,
  type AiBinding,
} from "../src/gateway.ts";

const FIRM = "firm_t" as FirmId;

// A fake AI binding capturing the model + options it is called with, and replaying a canned response
// shaped like the gateway's (text + a usage object).
function fakeAi(response: unknown): {
  ai: AiBinding;
  calls: Array<{ model: string; options: unknown }>;
} {
  const calls: Array<{ model: string; options: unknown }> = [];
  return {
    calls,
    ai: {
      async run(model, _input, options) {
        calls.push({ model, options });
        return response;
      },
    },
  };
}

// A streaming fake whose run() returns an async generator of deltas plus a terminal usage object the
// stream closure reads after the stream drains.
function streamingAi(
  deltas: string[],
  usage: { prompt_tokens: number; completion_tokens: number },
) {
  async function* gen(): AsyncGenerator<string> {
    for (const delta of deltas) yield delta;
  }
  const stream = gen() as AsyncGenerator<string> & {
    usage: { prompt_tokens: number; completion_tokens: number };
  };
  stream.usage = usage; // extractUsage reads .usage off the returned object
  return { ai: { run: async () => stream } satisfies AiBinding };
}

describe("createGatewayInferencePort.generate", () => {
  it("routes through the gateway with caching off, logging off, derived metadata; returns usage", async () => {
    const { ai, calls } = fakeAi({
      response: "Drafted clause.",
      usage: { prompt_tokens: 11, completion_tokens: 22 },
    });
    const port = createGatewayInferencePort({ ai, env: "production" });
    const result = await port.generate({
      modelId: "anthropic/claude-opus-5-5",
      prompt: "Draft a clause.",
      firmId: FIRM,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe("Drafted clause.");
      expect(result.value.usage).toEqual({ inputTokens: 11, outputTokens: 22 });
      expect(result.value.snapshotId).toBe("claude-opus-5-5");
    }
    expect(calls[0]?.model).toBe("anthropic/claude-opus-5-5");
    const options = calls[0]?.options as {
      gateway: {
        id: string;
        skipCache: boolean;
        collectLog: boolean;
        metadata: Record<string, string>;
      };
    };
    expect(options.gateway.id).toBe(GATEWAY_ID);
    expect(options.gateway.skipCache).toBe(true);
    expect(options.gateway.collectLog).toBe(false);
    expect(options.gateway.metadata.firm_id).toBe("firm_t");
  });

  it("parses the Anthropic Messages response shape (content[0].text + input_tokens/output_tokens)", async () => {
    // The default reasoning model (anthropic/claude-opus-5-5) routed via the gateway returns a native
    // Anthropic Messages shape — not the Workers AI shape — so the parsers must handle both.
    const { ai } = fakeAi({
      content: [{ type: "text", text: "Drafted clause." }],
      usage: { input_tokens: 11, output_tokens: 22 },
    });
    const port = createGatewayInferencePort({ ai, env: "production" });
    const result = await port.generate({
      modelId: "anthropic/claude-opus-5-5",
      prompt: "Draft a clause.",
      firmId: FIRM,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe("Drafted clause.");
      expect(result.value.usage).toEqual({ inputTokens: 11, outputTokens: 22 });
    }
  });

  it("rejects a non-ZDR model fail-closed without ever calling the binding", async () => {
    const { ai, calls } = fakeAi({ response: "x", usage: {} });
    const port = createGatewayInferencePort({ ai, env: "production" });
    const result = await port.generate({
      modelId: "anthropic/not-in-catalog",
      prompt: "x",
      firmId: FIRM,
    });
    expect(result).toMatchObject({ ok: false, reason: "adapter-error" });
    if (!result.ok) expect(result.problem?.retryable).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("maps a thrown binding failure to a caller-safe adapter-error (no upstream body spliced)", async () => {
    const port = createGatewayInferencePort({
      ai: { run: vi.fn().mockRejectedValue(new Error("upstream 503: secret-token-leak")) },
      env: "production",
    });
    const result = await port.generate({
      modelId: "anthropic/claude-opus-5-5",
      prompt: "x",
      firmId: FIRM,
    });
    expect(result).toMatchObject({ ok: false, reason: "adapter-error" });
    if (!result.ok) expect(result.problem?.detail ?? "").not.toContain("secret-token-leak");
  });

  it("parses the OpenAI-compatible response shape (choices[0].message.content + prompt_tokens/completion_tokens)", async () => {
    // The gateway can route to OpenAI-compatible providers; responseText and extractUsage must handle
    // that shape in addition to the Workers AI native and Anthropic Messages shapes.
    const { ai } = fakeAi({
      choices: [{ message: { content: "Drafted via OpenAI shape." } }],
      usage: { prompt_tokens: 9, completion_tokens: 4 },
    });
    const port = createGatewayInferencePort({ ai, env: "production" });
    const result = await port.generate({
      modelId: "anthropic/claude-opus-5-5",
      prompt: "Draft a clause.",
      firmId: FIRM,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe("Drafted via OpenAI shape.");
      expect(result.value.usage).toEqual({ inputTokens: 9, outputTokens: 4 });
    }
  });

  it("respects a present-but-zero usage object (zero is not the same as missing)", async () => {
    // extractUsage must treat { input_tokens: 0, output_tokens: 0 } as an explicit zero rather than
    // falling back to a default — the distinction matters for accurate metering.
    const { ai } = fakeAi({ response: "x", usage: { input_tokens: 0, output_tokens: 0 } });
    const port = createGatewayInferencePort({ ai, env: "production" });
    const result = await port.generate({
      modelId: "anthropic/claude-opus-5-5",
      prompt: "x",
      firmId: FIRM,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("yields zero usage when no usage field is present (absent usage does not throw)", async () => {
    // A response with no usage field at all must not throw on the metering path; extractUsage
    // defaults both token counts to 0 rather than propagating undefined.
    const { ai } = fakeAi({ response: "x" });
    const port = createGatewayInferencePort({ ai, env: "production" });
    const result = await port.generate({
      modelId: "anthropic/claude-opus-5-5",
      prompt: "x",
      firmId: FIRM,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

describe("createGatewayInferencePort.generateStream", () => {
  it("relays deltas and resolves usage only after the stream drains", async () => {
    const { ai } = streamingAi(["Draf", "ted ", "clause."], {
      prompt_tokens: 5,
      completion_tokens: 7,
    });
    const port = createGatewayInferencePort({ ai, env: "production" });
    const result = await port.generateStream({
      modelId: "anthropic/claude-opus-5-5",
      prompt: "Draft.",
      firmId: FIRM,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.snapshotId).toBe("claude-opus-5-5");
    const collected: string[] = [];
    for await (const delta of result.value.stream) collected.push(delta);
    expect(collected.join("")).toBe("Drafted clause.");
    // Usage resolves once the stream has drained.
    expect(await result.value.usage).toEqual({ inputTokens: 5, outputTokens: 7 });
  });

  it("normalizes a mid-stream throw to a caller-safe error and still settles usage (no hang)", async () => {
    // A stream that yields one delta, then throws an upstream error echoing a secret marker. The relay
    // must map the throw to a caller-safe message (no leaked body) AND settle usage so an awaiting
    // consumer never hangs.
    async function* gen(): AsyncGenerator<string> {
      yield "Draf";
      throw new Error("upstream 500: secret-stream-leak");
    }
    const ai = { run: async () => gen() } satisfies AiBinding;
    const port = createGatewayInferencePort({ ai, env: "production" });
    const result = await port.generateStream({
      modelId: "anthropic/claude-opus-5-5",
      prompt: "Draft.",
      firmId: FIRM,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const drain = (async () => {
      for await (const _delta of result.value.stream) {
        // drain to the mid-stream throw
      }
    })();
    await expect(drain).rejects.toThrow();
    await expect(drain).rejects.not.toThrow(/secret-stream-leak/);
    // Usage settles (resolves, does not hang) even though the stream failed mid-iteration.
    expect(await result.value.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("sends a model hosted on Cloudflare the default answer length, and a third-party model none", async () => {
    // A streamed draft on a Workers AI model would otherwise stop at its 256-token default.
    const inputs: unknown[] = [];
    const ai: AiBinding = {
      async run(_model, input) {
        inputs.push(input);
        return (async function* (): AsyncGenerator<string> {
          yield "x";
        })();
      },
    };
    const port = createGatewayInferencePort({ ai, env: "production" });
    await port.generateStream({
      modelId: PLATFORM_ON_CLOUDFLARE_REASONING_MODEL_ID,
      prompt: "Draft.",
      firmId: FIRM,
    });
    await port.generateStream({
      modelId: "anthropic/claude-opus-4-8",
      prompt: "Draft.",
      firmId: FIRM,
    });
    await port.generate({
      modelId: PLATFORM_ON_CLOUDFLARE_REASONING_MODEL_ID,
      prompt: "x",
      firmId: FIRM,
    });
    expect(inputs[0]).toEqual({
      prompt: "Draft.",
      stream: true,
      max_tokens: ON_CLOUDFLARE_DEFAULT_MAXIMUM_OUTPUT_TOKENS,
    });
    expect(inputs[1]).toEqual({ prompt: "Draft.", stream: true });
    expect(inputs[2]).toEqual({
      prompt: "x",
      max_tokens: ON_CLOUDFLARE_DEFAULT_MAXIMUM_OUTPUT_TOKENS,
    });
  });

  it("rejects a non-ZDR model fail-closed without ever calling the binding", async () => {
    const { ai, calls } = fakeAi({ response: "x", usage: {} });
    const port = createGatewayInferencePort({ ai, env: "production" });
    const result = await port.generateStream({
      modelId: "anthropic/not-in-catalog",
      prompt: "x",
      firmId: FIRM,
    });
    expect(result).toMatchObject({ ok: false, reason: "adapter-error" });
    if (!result.ok) expect(result.problem?.retryable).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("createGatewayInferencePort.embed", () => {
  it("uses the platform-fixed embedding model (no firm-selectable arg)", async () => {
    const { ai, calls } = fakeAi({
      data: [[0.1, 0.2]],
      usage: { prompt_tokens: 3, completion_tokens: 0 },
    });
    const port = createGatewayInferencePort({ ai, env: "production" });
    const result = await port.embed({ text: "embed me", firmId: FIRM });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.vector).toEqual([0.1, 0.2]);
    // The model is the catalog's single embedding entry — asserted via its slot, not a hardcoded id.
    expect(typeof calls[0]?.model).toBe("string");
    const embedCall = calls[0] as { options: { gateway: { metadata: { slot: string } } } };
    expect(embedCall.options.gateway.metadata.slot).toBe("embedding");
  });
});
