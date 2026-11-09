// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { createMemoryLogger } from "@magna-carta/telemetry/logger";
import { describe, expect, it } from "vitest";
import {
  createCloudflareEmailAdapter,
  type CloudflareEmailBinding,
} from "../src/email-cloudflare.ts";

function fakeBinding(behavior: "ok" | "throw" = "ok") {
  const sent: Array<{ to: string; from: string; subject: string; text?: string }> = [];
  const binding: CloudflareEmailBinding = {
    send: (message) => {
      if (behavior === "throw") return Promise.reject(new Error("upstream email failure"));
      sent.push(message);
      return Promise.resolve({ ok: true });
    },
  };
  return { binding, sent };
}

const FROM = "no-reply@magnacarta.esq";

describe("createCloudflareEmailAdapter", () => {
  it("sends to/from/subject/text through the binding and logs email.sent (outcome: sent)", async () => {
    const { binding, sent } = fakeBinding();
    const logger = createMemoryLogger();
    const adapter = createCloudflareEmailAdapter(binding, FROM, logger);

    await adapter({
      to: "user@example.com",
      subject: "Set your password",
      text: "https://app/reset/abc",
      messageClass: "password-reset",
    });

    expect(sent).toEqual([
      {
        to: "user@example.com",
        from: FROM,
        subject: "Set your password",
        text: "https://app/reset/abc",
      },
    ]);
    const event = logger.events.find((e) => e.name === "email.sent");
    expect(event?.fields).toEqual({ messageClass: "password-reset", outcome: "sent" });
  });

  it("on a send failure logs outcome: failed and RETHROWS (silent email loss is unacceptable)", async () => {
    const { binding } = fakeBinding("throw");
    const logger = createMemoryLogger();
    const adapter = createCloudflareEmailAdapter(binding, FROM, logger);

    await expect(
      adapter({ to: "user@example.com", subject: "x", text: "y", messageClass: "password-reset" }),
    ).rejects.toThrow("upstream email failure");
    const event = logger.events.find((e) => e.name === "email.sent");
    expect(event?.fields).toEqual({ messageClass: "password-reset", outcome: "failed" });
  });

  it("never logs body content — the email.sent event carries only messageClass + outcome", async () => {
    const { binding } = fakeBinding();
    const logger = createMemoryLogger();
    const adapter = createCloudflareEmailAdapter(binding, FROM, logger);

    await adapter({ to: "user@example.com", subject: "secret subject", text: "secret body link" });
    const event = logger.events.find((e) => e.name === "email.sent");
    // messageClass defaults to "unspecified"; the body/subject have no slot in the event.
    expect(event?.fields).toEqual({ messageClass: "unspecified", outcome: "sent" });
    expect(JSON.stringify(event)).not.toContain("secret");
  });
});
