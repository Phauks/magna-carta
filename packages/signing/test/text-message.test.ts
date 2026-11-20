import { describe, expect, it } from "vitest";

import {
  deferredTextMessagePort,
  reasonForTelnyxStatus,
  telnyxTextMessagePort,
} from "../src/text-message.ts";

const credentials = { apiKey: "test-key", from: "+17025550100" };
const message = { to: "+17025550147", text: "123456 is your code." };

function answering(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const transport = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, transport };
}

describe("the Telnyx text-message port", () => {
  it("posts the number, the sending number and the words, with the key in a header", async () => {
    const { calls, transport } = answering(200, { data: { id: "message-1" } });
    const outcome = await telnyxTextMessagePort(credentials, transport).send(message);
    expect(outcome).toEqual({ kind: "sent" });
    expect(calls[0]?.url).toBe("https://api.telnyx.com/v2/messages");
    expect(calls[0]?.init?.method).toBe("POST");
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-key",
    );
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      from: "+17025550100",
      to: "+17025550147",
      text: "123456 is your code.",
    });
  });

  it("reads a refusal into a reason it can count", async () => {
    const { transport } = answering(403, { errors: [{ code: "40013" }] });
    expect(await telnyxTextMessagePort(credentials, transport).send(message)).toEqual({
      kind: "failed",
      reason: "number-not-allowed",
    });
    expect(reasonForTelnyxStatus(429)).toBe("rate-limited");
    expect(reasonForTelnyxStatus(401)).toBe("refused");
    expect(reasonForTelnyxStatus(422)).toBe("number-not-allowed");
  });

  it("calls an answer with no message id malformed", async () => {
    const { transport } = answering(200, { data: {} });
    expect(await telnyxTextMessagePort(credentials, transport).send(message)).toEqual({
      kind: "failed",
      reason: "malformed",
    });
  });

  it("reports a network fault as transport", async () => {
    const transport = (async () => {
      throw new TypeError("network");
    }) as typeof fetch;
    expect(await telnyxTextMessagePort(credentials, transport).send(message)).toEqual({
      kind: "failed",
      reason: "transport",
    });
  });

  it("sends nothing when no provider is set up", async () => {
    const port = deferredTextMessagePort();
    expect(port.engine).toBe("none");
    expect(await port.send(message)).toEqual({ kind: "failed", reason: "not-configured" });
  });
});
