import { describe, expect, it } from "vitest";
import { canonicalizeForHash, deriveDedupKey } from "../src/dedup.ts";
import { makeParsedMessage } from "./fixtures.ts";

describe("deriveDedupKey", () => {
  it("keys on the Message-ID when present — two captures of the same mail converge", async () => {
    const one = await deriveDedupKey(makeParsedMessage());
    const two = await deriveDedupKey(
      makeParsedMessage({ subject: "totally different subject", textBodies: ["different body"] }),
    );
    expect(one.basis).toBe("messageId");
    expect(one.key).toBe(two.key); // same Message-ID → same key regardless of other fields
  });

  it("never flattens header vs MAPI provenance — same bytes, different origin, different key", async () => {
    const header = await deriveDedupKey(
      makeParsedMessage({ messageIdentifier: { value: "<x@example.com>", provenance: "header" } }),
    );
    const mapi = await deriveDedupKey(
      makeParsedMessage({ messageIdentifier: { value: "<x@example.com>", provenance: "mapi" } }),
    );
    expect(header.key).not.toBe(mapi.key);
    expect(header.basis).toBe("messageId");
    expect(mapi.basis).toBe("messageId");
  });

  it("falls back to a content hash when the identifier is absent", async () => {
    const decision = await deriveDedupKey(
      makeParsedMessage({ messageIdentifier: { value: null, provenance: "absent" } }),
    );
    expect(decision.basis).toBe("contentHash");
    expect(decision.key.startsWith("contentHash:")).toBe(true);
  });

  it("content-hash fallback converges across two recipient copies with churned headers/whitespace", async () => {
    const original = makeParsedMessage({
      messageIdentifier: { value: null, provenance: "absent" },
      from: [{ displayName: "Alice", address: "Alice@Example.com" }],
      to: [{ displayName: "Bob", address: "bob@firm.example" }],
      subject: "  Quarterly report ",
      textBodies: ["Line one.\n\nLine two."],
    });
    // A forwarder rewrote header casing, reordered recipients cosmetically, and reflowed the body.
    const copy = makeParsedMessage({
      messageIdentifier: { value: null, provenance: "absent" },
      from: [{ displayName: "Alice Adams", address: "alice@example.com" }],
      to: [{ displayName: "Bob Barr", address: "BOB@firm.example" }],
      subject: "Quarterly report",
      textBodies: ["Line one.    Line two."],
    });
    const a = await deriveDedupKey(original);
    const b = await deriveDedupKey(copy);
    expect(a.key).toBe(b.key);
  });

  it("distinct messages get distinct content-hash keys", async () => {
    const a = await deriveDedupKey(
      makeParsedMessage({
        messageIdentifier: { value: null, provenance: "absent" },
        textBodies: ["one"],
      }),
    );
    const b = await deriveDedupKey(
      makeParsedMessage({
        messageIdentifier: { value: null, provenance: "absent" },
        textBodies: ["two"],
      }),
    );
    expect(a.key).not.toBe(b.key);
  });
});

describe("canonicalizeForHash", () => {
  it("is stable under address casing and body whitespace", () => {
    const a = canonicalizeForHash(
      makeParsedMessage({
        from: [{ displayName: null, address: "A@B.com" }],
        textBodies: ["x   y"],
      }),
    );
    const b = canonicalizeForHash(
      makeParsedMessage({ from: [{ displayName: null, address: "a@b.com" }], textBodies: ["x y"] }),
    );
    expect(a).toBe(b);
  });
});
