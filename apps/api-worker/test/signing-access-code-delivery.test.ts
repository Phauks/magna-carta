// A signer's code goes the way the sender chose, and a failure names its way and an Error ID while
// the number and the digits stay out of every log line.
import { describe, expect, it } from "vitest";
import type { Bindings } from "../src/bindings.ts";
import type { SendEmail } from "../src/email-port.ts";
import { deliverAccessCode } from "../src/signing/access-code-delivery.ts";
import type { SignerView } from "../src/signing/signer-service.ts";
import type { TextMessage, TextMessagePort } from "@magna-carta/signing/text-message";

const env = {} as Bindings;

function signer(extra: Partial<SignerView["signer"]>): SignerView["signer"] {
  return {
    attributionLevel: "access-code",
    email: "jordan@example.com",
    codeChannel: "email",
    mobileNumber: null,
    ...extra,
  } as SignerView["signer"];
}

function textPort(sent: TextMessage[], ok = true): TextMessagePort {
  return {
    engine: "telnyx",
    send: (message) => {
      sent.push(message);
      return Promise.resolve(
        ok ? { kind: "sent" } : { kind: "failed", reason: "number-not-allowed" },
      );
    },
  };
}

function recordingLogger(lines: string[]) {
  return {
    log: (event: unknown) => lines.push(JSON.stringify(event)),
    count: (name: string, dimensions: unknown) =>
      lines.push(`${name} ${JSON.stringify(dimensions)}`),
  } as never;
}

describe("sending a signer their code", () => {
  it("texts it to the number when the sender chose a text code", async () => {
    const sent: TextMessage[] = [];
    const mailed: unknown[] = [];
    const delivery = await deliverAccessCode({
      env,
      sendEmail: () =>
        ((message: unknown) => {
          mailed.push(message);
          return Promise.resolve();
        }) as SendEmail,
      signer: signer({ codeChannel: "text", mobileNumber: "+17025550147" }),
      firmName: "Example Law",
      digits: "123456",
      correlationId: "c",
      textPort: textPort(sent),
    });
    expect(delivery).toEqual({ delivered: true, sentTo: "(•••) •••-0147" });
    expect(sent).toEqual([
      {
        to: "+17025550147",
        text: "123456 is your code to sign the document Example Law sent you. It works for 10 minutes.",
      },
    ]);
    expect(mailed).toEqual([]);
  });

  it("emails it otherwise", async () => {
    const sent: TextMessage[] = [];
    const mailed: Array<{ to: string }> = [];
    const delivery = await deliverAccessCode({
      env,
      sendEmail: () =>
        ((message: { to: string }) => {
          mailed.push(message);
          return Promise.resolve();
        }) as SendEmail,
      signer: signer({}),
      firmName: "Example Law",
      digits: "123456",
      correlationId: "c",
      textPort: textPort(sent),
    });
    expect(delivery.delivered).toBe(true);
    expect(mailed[0]?.to).toBe("jordan@example.com");
    expect(sent).toEqual([]);
  });

  it("names a failed text and logs neither the number nor the code", async () => {
    const lines: string[] = [];
    const delivery = await deliverAccessCode({
      env,
      sendEmail: () => (() => Promise.resolve()) as SendEmail,
      signer: signer({ codeChannel: "text", mobileNumber: "+17025550147" }),
      firmName: "Example Law",
      digits: "123456",
      logger: recordingLogger(lines),
      correlationId: "c",
      textPort: textPort([], false),
    });
    expect(delivery).toMatchObject({ delivered: false, channel: "text" });
    expect(lines.join("\n")).toContain("number-not-allowed");
    expect(lines.join("\n")).not.toContain("0147");
    expect(lines.join("\n")).not.toContain("123456");
  });
});
