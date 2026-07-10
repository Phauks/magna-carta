import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { EmailError, ensureReady, extractPart, parseMailbox, parseMessage } from "../src/index.js";

const wasmBytes = readFileSync(
  fileURLToPath(new URL("../src/pkg/email_core_bg.wasm", import.meta.url)),
);

function fixture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(
      fileURLToPath(new URL(`../../../crates/email-core/tests/fixtures/${name}`, import.meta.url)),
    ),
  );
}

describe("@magna-carta/email wasm wrapper", () => {
  beforeAll(async () => {
    await ensureReady(wasmBytes);
  });

  describe("parseMessage", () => {
    it("returns a header-sourced identifier for a simple .eml fixture", async () => {
      const message = await parseMessage(fixture("simple.eml"));

      expect(message.messageIdentifier.provenance).toBe("header");
      expect(message.messageIdentifier.value).toBe("first@example.test");
      expect(message.subject).toBe("Retainer");
      expect(message.sourceFormat).toBe("eml");
    });

    it("tags an attachment part with an inputRange locator", async () => {
      const message = await parseMessage(fixture("with-attachment.eml"));

      expect(message.parts.length).toBeGreaterThan(0);
      const [first] = message.parts;
      expect(first.locator.kind).toBe("inputRange");
      if (first.locator.kind === "inputRange") {
        expect(first.locator.end).toBeGreaterThan(first.locator.start);
      }
    });

    it("rejects a PDF magic header with EmailError code unsupported", async () => {
      await expect(parseMessage(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).rejects.toSatisfy(
        (err: unknown) => err instanceof EmailError && err.code === "unsupported",
      );
    });
  });

  describe("parseMailbox", () => {
    it("returns messages and failures for a two-message mbox fixture", async () => {
      const outcome = await parseMailbox(fixture("two-messages.mbox"));

      expect(outcome.failures).toHaveLength(0);
      expect(outcome.messages).toHaveLength(2);
      expect(outcome.messages[0].subject).toBe("First");
      expect(outcome.messages[0].sourceFormat).toBe("mboxMember");
      expect(outcome.messages[1].subject).toBe("Second");
    });
  });

  describe("extractPart", () => {
    it("returns the attachment bytes by index", async () => {
      const bytes = await extractPart(fixture("with-attachment.eml"), 0);
      expect(bytes).toEqual(new TextEncoder().encode("JVBERi0xLjQKJeLjz9MK\r\n"));
    });

    it("rejects an out-of-range index with EmailError code partNotFound", async () => {
      await expect(extractPart(fixture("simple.eml"), 999)).rejects.toSatisfy(
        (err: unknown) => err instanceof EmailError && err.code === "partNotFound",
      );
    });
  });
});
