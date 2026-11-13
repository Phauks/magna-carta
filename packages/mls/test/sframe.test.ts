import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  decryptFrame,
  deriveKey,
  encodeHeader,
  encryptFrame,
  keyIdentifier,
  parseHeader,
  readKeyIdentifier,
  SframeError,
  SframeKeyRing,
  vp8ClearPrefixLength,
} from "../src/sframe.ts";

function hex(text: string): Uint8Array {
  const clean = text.replaceAll(/\s/g, "");
  return Uint8Array.from({ length: clean.length / 2 }, (_, index) =>
    Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16),
  );
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Every header vector in RFC 9605, appendix C.1, copied verbatim into the fixture.
const headerVectors = JSON.parse(
  readFileSync(fileURLToPath(new URL("./sframe-header-vectors.json", import.meta.url)), "utf8"),
) as readonly { kid: string; ctr: string; header: string }[];

describe("the SFrame header", () => {
  it("encodes and reads back every vector in the RFC", () => {
    expect(headerVectors.length).toBe(289);
    for (const vector of headerVectors) {
      const kid = BigInt(`0x${vector.kid}`);
      const ctr = BigInt(`0x${vector.ctr}`);
      expect(toHex(encodeHeader(kid, ctr))).toBe(vector.header);
      const parsed = parseHeader(hex(vector.header));
      expect(parsed).toEqual({ kid, ctr, length: vector.header.length / 2 });
    }
  });

  it("refuses a header cut short or not in its shortest form", () => {
    expect(parseHeader(new Uint8Array(0))).toBeUndefined();
    expect(parseHeader(hex("0a01"))).toBeUndefined();
    // A counter of 5 spelled out in a byte, where the config byte could carry it.
    expect(parseHeader(hex("0805"))).toBeUndefined();
    // A counter of 0x100 in three bytes.
    expect(parseHeader(hex("0a000100"))).toBeUndefined();
  });
});

describe("the key identifier", () => {
  it("carries the sender, the epoch's low bits and the stream, and reads back", () => {
    const kid = keyIdentifier(299, 37, "screen");
    expect(readKeyIdentifier(kid)).toEqual({
      senderLeafIndex: 299,
      epochLowBits: 37 % 16,
      context: 2n,
    });
    expect(keyIdentifier(3, 14, "audio")).toBe(0x3en);
    expect(keyIdentifier(0, 0, "camera")).not.toBe(keyIdentifier(0, 0, "audio"));
  });

  it("refuses a sender past its bits", () => {
    expect(() => keyIdentifier(1024, 0, "audio")).toThrow(SframeError);
    expect(() => keyIdentifier(-1, 0, "audio")).toThrow(SframeError);
  });
});

describe("the frame cipher", () => {
  // RFC 9605, appendix C.3, cipher suite 0x0004 (AES_128_GCM_SHA256_128).
  const vector = {
    kid: 0x123n,
    ctr: 0x4567n,
    baseKey: hex("000102030405060708090a0b0c0d0e0f"),
    sframeSalt: "75234edefe07819026751816",
    metadata: hex("4945544620534672616d65205747"),
    plaintext: hex("64726166742d696574662d736672616d652d656e63"),
    ciphertext:
      "9901234567b7412c2513a1b66dbb48841bbaf17f598751176ad847681a69c6d0b091c07018ce4adb34eb",
  };

  it("matches the RFC's vector both ways", async () => {
    const key = await deriveKey(vector.baseKey, vector.kid);
    expect(toHex(key.salt)).toBe(vector.sframeSalt);
    const frame = await encryptFrame(
      key,
      vector.kid,
      vector.ctr,
      vector.metadata,
      vector.plaintext,
    );
    expect(toHex(frame)).toBe(vector.ciphertext);
    expect(await decryptFrame(key, vector.metadata, hex(vector.ciphertext))).toEqual(
      vector.plaintext,
    );
  });

  it("drops a frame whose bytes, header or metadata were touched", async () => {
    const key = await deriveKey(vector.baseKey, vector.kid);
    const frame = hex(vector.ciphertext);
    const flipped = Uint8Array.from(frame);
    flipped[frame.length - 1] = (flipped[frame.length - 1] ?? 0) ^ 1;
    expect(await decryptFrame(key, vector.metadata, flipped)).toBeUndefined();
    expect(await decryptFrame(key, hex("00"), frame)).toBeUndefined();
    const otherCounter = Uint8Array.from(frame);
    otherCounter[4] = (otherCounter[4] ?? 0) ^ 1;
    expect(await decryptFrame(key, vector.metadata, otherCounter)).toBeUndefined();
    expect(await decryptFrame(key, vector.metadata, frame.subarray(0, 10))).toBeUndefined();
  });
});

describe("the key ring", () => {
  const base = (fill: number) => new Uint8Array(16).fill(fill);
  const plaintext = new TextEncoder().encode("a frame of audio");

  it("decrypts what another member encrypted under the same epoch, and never reuses a counter", async () => {
    const sender = new SframeKeyRing();
    const receiver = new SframeKeyRing();
    sender.addEpoch(4, base(1));
    receiver.addEpoch(4, base(1));
    const first = await sender.encrypt(7, "audio", new Uint8Array(0), plaintext);
    const second = await sender.encrypt(7, "audio", new Uint8Array(0), plaintext);
    expect(parseHeader(first)?.ctr).toBe(0n);
    expect(parseHeader(second)?.ctr).toBe(1n);
    expect(toHex(first)).not.toBe(toHex(second));
    expect(await receiver.decrypt(new Uint8Array(0), first)).toEqual(plaintext);
    expect(await receiver.decrypt(new Uint8Array(0), second)).toEqual(plaintext);
  });

  it("keeps the epoch before a commit for frames in flight, and no older", async () => {
    const sender = new SframeKeyRing();
    const receiver = new SframeKeyRing(2);
    sender.addEpoch(1, base(1));
    const fromEpochOne = await sender.encrypt(0, "camera", new Uint8Array(0), plaintext);
    receiver.addEpoch(1, base(1));
    receiver.addEpoch(2, base(2));
    expect(await receiver.decrypt(new Uint8Array(0), fromEpochOne)).toEqual(plaintext);
    receiver.addEpoch(3, base(3));
    expect(await receiver.decrypt(new Uint8Array(0), fromEpochOne)).toBeUndefined();
  });

  it("forgets an epoch when a new one shares its low bits", async () => {
    const sender = new SframeKeyRing();
    const receiver = new SframeKeyRing(16);
    sender.addEpoch(2, base(2));
    const old = await sender.encrypt(0, "audio", new Uint8Array(0), plaintext);
    receiver.addEpoch(2, base(2));
    receiver.addEpoch(18, base(18));
    expect(await receiver.decrypt(new Uint8Array(0), old)).toBeUndefined();
  });

  it("drops a frame with no header, and refuses to send with no key", async () => {
    const ring = new SframeKeyRing();
    expect(await ring.decrypt(new Uint8Array(0), new Uint8Array(0))).toBeUndefined();
    await expect(ring.encrypt(0, "audio", new Uint8Array(0), plaintext)).rejects.toThrow(
      SframeError,
    );
    ring.addEpoch(1, base(1));
    ring.clear();
    expect(ring.currentEpoch).toBeUndefined();
    await expect(ring.encrypt(0, "audio", new Uint8Array(0), plaintext)).rejects.toThrow(
      SframeError,
    );
  });
});

describe("the VP8 clear prefix", () => {
  it("is ten bytes on a keyframe and one otherwise", () => {
    expect(vp8ClearPrefixLength(new Uint8Array(40).fill(0x10))).toBe(10);
    expect(vp8ClearPrefixLength(new Uint8Array(40).fill(0x11))).toBe(1);
    expect(vp8ClearPrefixLength(new Uint8Array(4))).toBe(4);
    expect(vp8ClearPrefixLength(new Uint8Array(0))).toBe(0);
  });
});
