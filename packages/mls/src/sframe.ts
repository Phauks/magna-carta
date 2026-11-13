// SFrame (RFC 9605): one media frame encrypted at a time, under keys derived from the meeting group's
// per-epoch base key. Suite AES_128_GCM_SHA256_128, on WebCrypto, so it runs in the frame transform's
// worker with no WebAssembly at all.
//
// THIS IS SECURITY CODE, and every rule in it is the RFC's or is stated here with its reason. Three that
// are easy to break by tidying:
//
// - A (key identifier, counter) pair is used for exactly one frame. The key identifier carries the
//   sender's leaf, the epoch's low bits and a stream number, so two streams from one sender never share a
//   counter, and the counter starts again only under a new epoch's key.
// - A frame that does not decrypt is DROPPED, never shown and never passed through. `decrypt` answers
//   `undefined` for every failure alike, and does the same work whether the key was known or not.
// - When a new epoch arrives whose low bits match an old one, the old one is removed first (RFC 9605,
//   section 5.2), so a key identifier can never name two keys.

/** The suite's registry value: AES_128_GCM_SHA256_128. */
export const SFRAME_CIPHER_SUITE = 0x0004;
/** AEAD.Nk, AEAD.Nn and AEAD.Nt for the suite, in bytes. */
export const SFRAME_KEY_LENGTH = 16;
export const SFRAME_NONCE_LENGTH = 12;
export const SFRAME_TAG_LENGTH = 16;

/**
 * The key identifier's layout (RFC 9605, section 5.2): the epoch's low `E` bits, then the sender's leaf
 * index in `S` bits, then a stream number above them. E = 4 lets sixteen epochs be told apart while
 * frames from just before a commit are still arriving; S = 10 leaves room past the room's 300.
 */
export const KID_EPOCH_BITS = 4;
export const KID_SENDER_BITS = 10;
export const KID_MAXIMUM_SENDER = (1 << KID_SENDER_BITS) - 1;
/** The streams one participant sends, each under its own key identifier and counter. */
export const SFRAME_STREAMS = { audio: 0, camera: 1, screen: 2 } as const;
export type SframeStream = keyof typeof SFRAME_STREAMS;

const EPOCH_MASK = (1n << BigInt(KID_EPOCH_BITS)) - 1n;
const SENDER_MASK = (1n << BigInt(KID_SENDER_BITS)) - 1n;
const UINT64_MAXIMUM = (1n << 64n) - 1n;
const KEY_LABEL = new TextEncoder().encode("SFrame 1.0 Secret key ");
const SALT_LABEL = new TextEncoder().encode("SFrame 1.0 Secret salt ");

export class SframeError extends Error {
  constructor(readonly code: "baseKey" | "keyIdentifier" | "counter" | "frame") {
    super(code);
    this.name = "SframeError";
  }
}

/** The key identifier for a sender's stream in an epoch. */
export function keyIdentifier(
  senderLeafIndex: number,
  epoch: number,
  stream: SframeStream,
): bigint {
  if (
    !Number.isInteger(senderLeafIndex) ||
    senderLeafIndex < 0 ||
    senderLeafIndex > KID_MAXIMUM_SENDER
  ) {
    throw new SframeError("keyIdentifier");
  }
  if (!Number.isInteger(epoch) || epoch < 0) throw new SframeError("keyIdentifier");
  const context = BigInt(SFRAME_STREAMS[stream]);
  return (
    (context << BigInt(KID_SENDER_BITS + KID_EPOCH_BITS)) |
    (BigInt(senderLeafIndex) << BigInt(KID_EPOCH_BITS)) |
    (BigInt(epoch) & EPOCH_MASK)
  );
}

/** What a key identifier says: whose frame, in which epoch (low bits only), on which stream. */
export function readKeyIdentifier(kid: bigint): {
  readonly senderLeafIndex: number;
  readonly epochLowBits: number;
  readonly context: bigint;
} {
  return {
    epochLowBits: Number(kid & EPOCH_MASK),
    senderLeafIndex: Number((kid >> BigInt(KID_EPOCH_BITS)) & SENDER_MASK),
    context: kid >> BigInt(KID_SENDER_BITS + KID_EPOCH_BITS),
  };
}

function bigEndian(value: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let rest = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    bytes[index] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return bytes;
}

function minimumLength(value: bigint): number {
  let length = 1;
  while (value >> BigInt(8 * length) !== 0n) length += 1;
  return length;
}

/** The header for a key identifier and counter (RFC 9605, section 4.3), in its shortest form. */
export function encodeHeader(kid: bigint, ctr: bigint): Uint8Array {
  if (kid < 0n || kid > UINT64_MAXIMUM) throw new SframeError("keyIdentifier");
  if (ctr < 0n || ctr > UINT64_MAXIMUM) throw new SframeError("counter");
  const kidLength = kid < 8n ? 0 : minimumLength(kid);
  const ctrLength = ctr < 8n ? 0 : minimumLength(ctr);
  const header = new Uint8Array(1 + kidLength + ctrLength);
  const kidBits = kidLength === 0 ? Number(kid) : 0b1000 | (kidLength - 1);
  const ctrBits = ctrLength === 0 ? Number(ctr) : 0b1000 | (ctrLength - 1);
  header[0] = (kidBits << 4) | ctrBits;
  if (kidLength > 0) header.set(bigEndian(kid, kidLength), 1);
  if (ctrLength > 0) header.set(bigEndian(ctr, ctrLength), 1 + kidLength);
  return header;
}

/**
 * Read a header from the front of `bytes`. Answers `undefined` for a header that is cut short or not in
 * its shortest form: a sender following the RFC never writes either, and accepting a second spelling of
 * one header would be a second AAD for the same frame.
 */
export function parseHeader(
  bytes: Uint8Array,
): { readonly kid: bigint; readonly ctr: bigint; readonly length: number } | undefined {
  const config = bytes[0];
  if (config === undefined) return undefined;
  const readField = (
    bits: number,
    offset: number,
  ): { readonly value: bigint; readonly length: number } | undefined => {
    if ((bits & 0b1000) === 0) return { value: BigInt(bits & 0b111), length: 0 };
    const length = (bits & 0b111) + 1;
    if (offset + length > bytes.length) return undefined;
    let value = 0n;
    for (let index = 0; index < length; index += 1) {
      value = (value << 8n) | BigInt(bytes[offset + index] ?? 0);
    }
    if (value < 8n || minimumLength(value) !== length) return undefined;
    return { value, length };
  };
  const kid = readField(config >> 4, 1);
  if (kid === undefined) return undefined;
  const ctr = readField(config & 0x0f, 1 + kid.length);
  if (ctr === undefined) return undefined;
  return { kid: kid.value, ctr: ctr.value, length: 1 + kid.length + ctr.length };
}

function concatenate(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const whole = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    whole.set(part, offset);
    offset += part.length;
  }
  return whole;
}

/** One key identifier's key and salt (RFC 9605, section 4.4.2). */
export interface SframeKey {
  readonly key: CryptoKey;
  readonly salt: Uint8Array;
}

/** Derive a key identifier's AES-GCM key and salt from an epoch's base key, with HKDF-SHA-256. */
export async function deriveKey(baseKey: Uint8Array, kid: bigint): Promise<SframeKey> {
  if (baseKey.length !== SFRAME_KEY_LENGTH) throw new SframeError("baseKey");
  const suite = bigEndian(BigInt(SFRAME_CIPHER_SUITE), 2);
  const kidBytes = bigEndian(kid, 8);
  const material = await crypto.subtle.importKey("raw", concatenate(baseKey), "HKDF", false, [
    "deriveBits",
  ]);
  const expand = async (label: Uint8Array, length: number) =>
    new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: new Uint8Array(0),
          info: concatenate(label, kidBytes, suite),
        },
        material,
        length * 8,
      ),
    );
  const [keyBytes, salt] = await Promise.all([
    expand(KEY_LABEL, SFRAME_KEY_LENGTH),
    expand(SALT_LABEL, SFRAME_NONCE_LENGTH),
  ]);
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  keyBytes.fill(0);
  return { key, salt };
}

function nonceFor(salt: Uint8Array, ctr: bigint): Uint8Array<ArrayBuffer> {
  const counter = bigEndian(ctr, SFRAME_NONCE_LENGTH);
  return Uint8Array.from(salt, (byte, index) => byte ^ (counter[index] ?? 0));
}

/**
 * Encrypt one frame: header, then ciphertext and tag. `metadata` is authenticated and not encrypted (a
 * video frame's clear prefix travels as metadata, in front of the whole).
 */
export async function encryptFrame(
  key: SframeKey,
  kid: bigint,
  ctr: bigint,
  metadata: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const header = encodeHeader(kid, ctr);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonceFor(key.salt, ctr),
      additionalData: concatenate(header, metadata),
      tagLength: SFRAME_TAG_LENGTH * 8,
    },
    key.key,
    concatenate(plaintext),
  );
  return concatenate(header, new Uint8Array(ciphertext));
}

/** Decrypt one SFrame ciphertext with a known key, or `undefined` when it does not authenticate. */
export async function decryptFrame(
  key: SframeKey,
  metadata: Uint8Array,
  frame: Uint8Array,
): Promise<Uint8Array | undefined> {
  const header = parseHeader(frame);
  if (header === undefined || frame.length < header.length + SFRAME_TAG_LENGTH) return undefined;
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: nonceFor(key.salt, header.ctr),
        additionalData: concatenate(frame.subarray(0, header.length), metadata),
        tagLength: SFRAME_TAG_LENGTH * 8,
      },
      key.key,
      concatenate(frame.subarray(header.length)),
    );
    return new Uint8Array(plaintext);
  } catch {
    return undefined;
  }
}

/**
 * The epochs' keys one participant holds, encrypting its own streams and decrypting everybody else's.
 * `maximumEpochs` bounds how long the keys of an epoch already left behind keep decrypting frames that
 * were in flight across a commit.
 */
export class SframeKeyRing {
  readonly #epochs = new Map<number, { readonly epoch: number; readonly baseKey: Uint8Array }>();
  readonly #keys = new Map<bigint, Promise<SframeKey>>();
  readonly #counters = new Map<bigint, bigint>();
  #current: number | undefined;

  constructor(private readonly maximumEpochs = 2) {}

  /** The epoch the participant now encrypts under. */
  get currentEpoch(): number | undefined {
    return this.#current;
  }

  /** Take an epoch's base key, which becomes the one this participant encrypts under. */
  addEpoch(epoch: number, baseKey: Uint8Array): void {
    if (baseKey.length !== SFRAME_KEY_LENGTH) throw new SframeError("baseKey");
    if (!Number.isInteger(epoch) || epoch < 0) throw new SframeError("keyIdentifier");
    const lowBits = Number(BigInt(epoch) & EPOCH_MASK);
    this.#forget(lowBits);
    this.#epochs.set(lowBits, { epoch, baseKey: Uint8Array.from(baseKey) });
    this.#current = epoch;
    // Oldest first, by epoch: drop past the window.
    const held = [...this.#epochs.values()].toSorted((left, right) => left.epoch - right.epoch);
    for (const stale of held.slice(0, Math.max(0, held.length - this.maximumEpochs))) {
      this.#forget(Number(BigInt(stale.epoch) & EPOCH_MASK));
    }
  }

  /** Drop every key: the participant has left the group, or the meeting is paused. */
  clear(): void {
    for (const lowBits of [...this.#epochs.keys()]) this.#forget(lowBits);
    this.#current = undefined;
  }

  #forget(lowBits: number): void {
    const held = this.#epochs.get(lowBits);
    if (held === undefined) return;
    held.baseKey.fill(0);
    this.#epochs.delete(lowBits);
    for (const kid of [...this.#keys.keys()]) {
      if (Number(kid & EPOCH_MASK) === lowBits) {
        this.#keys.delete(kid);
        this.#counters.delete(kid);
      }
    }
  }

  #key(kid: bigint): Promise<SframeKey> | undefined {
    const known = this.#keys.get(kid);
    if (known !== undefined) return known;
    const held = this.#epochs.get(Number(kid & EPOCH_MASK));
    if (held === undefined) return undefined;
    const derived = deriveKey(held.baseKey, kid);
    this.#keys.set(kid, derived);
    return derived;
  }

  /** Encrypt one of this participant's frames, under the current epoch. */
  async encrypt(
    ownLeafIndex: number,
    stream: SframeStream,
    metadata: Uint8Array,
    plaintext: Uint8Array,
  ): Promise<Uint8Array> {
    if (this.#current === undefined) throw new SframeError("baseKey");
    const kid = keyIdentifier(ownLeafIndex, this.#current, stream);
    const key = this.#key(kid);
    if (key === undefined) throw new SframeError("baseKey");
    const ctr = this.#counters.get(kid) ?? 0n;
    if (ctr > UINT64_MAXIMUM) throw new SframeError("counter");
    this.#counters.set(kid, ctr + 1n);
    return encryptFrame(await key, kid, ctr, metadata, plaintext);
  }

  /**
   * Decrypt somebody's frame, or `undefined` when it must be dropped: no header, no key for its
   * epoch, or a frame that does not authenticate.
   */
  async decrypt(metadata: Uint8Array, frame: Uint8Array): Promise<Uint8Array | undefined> {
    const header = parseHeader(frame);
    if (header === undefined) return undefined;
    const key = this.#key(header.kid);
    if (key === undefined) return undefined;
    return decryptFrame(await key, metadata, frame);
  }
}

/**
 * How many bytes at the front of a VP8 frame stay readable: ten on a keyframe, one otherwise (the
 * frame tag's first byte, whose lowest bit is zero on a keyframe). The routing service reads them to
 * find keyframes and the picture size; they are authenticated as metadata and never encrypted.
 */
export function vp8ClearPrefixLength(frame: Uint8Array): number {
  const first = frame[0];
  if (first === undefined) return 0;
  const keyframe = (first & 0x01) === 0;
  return Math.min(frame.length, keyframe ? 10 : 1);
}
