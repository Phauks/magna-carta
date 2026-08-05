import { beforeAll, describe, expect, it } from "vitest";
import { verifyDkim, type DkimKeyLookup, type DkimKeyLookupResult } from "../src/dkim.ts";

// These tests sign real messages with a real RSA key and verify them through the module under test.
// The signed input is built here by hand — spelled out line by line from RFC 6376's canonicalization
// rules rather than by calling the implementation — so a bug in canonicalization shows up as a
// verification failure instead of being cancelled out on both sides.

let privateKey: CryptoKey;
let publicKeyRecord: string;

const DOMAIN = "example.test";
const SELECTOR = "sel";
const BODY = "Hello there.\r\n";

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  privateKey = pair.privateKey;
  const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
  publicKeyRecord = `v=DKIM1; k=rsa; p=${bytesToBase64(new Uint8Array(spki))}`;
});

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encode(text));
  return bytesToBase64(new Uint8Array(digest));
}

/** A lookup that answers with the generated key for the expected name and nothing for anything else. */
function keyLookup(result?: DkimKeyLookupResult): DkimKeyLookup {
  return async (name) => {
    if (result !== undefined) return result;
    return name === `${SELECTOR}._domainkey.${DOMAIN}`
      ? { kind: "records", records: [publicKeyRecord] }
      : { kind: "notFound" };
  };
}

interface SignOptions {
  readonly algorithm?: string;
  readonly canonicalization?: "relaxed/relaxed" | "simple/simple";
  readonly extraTags?: string;
  readonly body?: string;
}

/**
 * Build a signed message. The canonical forms below are written out literally, which is only tractable
 * because the message is deliberately trivial: three single-line headers and a one-line body.
 */
async function signedMessage(options: SignOptions = {}): Promise<string> {
  const algorithm = options.algorithm ?? "rsa-sha256";
  const canonicalization = options.canonicalization ?? "relaxed/relaxed";
  const body = options.body ?? BODY;
  const headers = [
    "From: Alice <alice@example.test>",
    "To: Bob <bob@example.test>",
    "Subject: Hello",
  ];

  // Body canonicalization. Relaxed drops the trailing empty line and leaves one CRLF; simple does the
  // same for this body, since it has no trailing whitespace and exactly one terminating CRLF.
  const canonicalBody = body;
  const bodyHash = await sha256Base64(canonicalBody);

  const tags =
    `v=1; a=${algorithm}; c=${canonicalization}; d=${DOMAIN}; s=${SELECTOR}; ` +
    `h=from:to:subject; ${options.extraTags ?? ""}bh=${bodyHash}; b=`;

  const canonicalHeaders =
    canonicalization === "relaxed/relaxed"
      ? "from:Alice <alice@example.test>\r\n" +
        "to:Bob <bob@example.test>\r\n" +
        "subject:Hello\r\n" +
        `dkim-signature:${tags}`
      : `${headers.join("\r\n")}\r\n` + `DKIM-Signature: ${tags}`;

  const signature = bytesToBase64(
    new Uint8Array(
      await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, encode(canonicalHeaders)),
    ),
  );
  return `DKIM-Signature: ${tags}${signature}\r\n${headers.join("\r\n")}\r\n\r\n${body}`;
}

describe("verifyDkim", () => {
  it("passes a message whose signature verifies, and names the signing domain", async () => {
    const verdict = await verifyDkim(encode(await signedMessage()), {
      lookupKeyRecords: keyLookup(),
    });
    expect(verdict.verdict).toBe("pass");
    expect(verdict.reason).toBe("passed");
    expect(verdict.signingDomain).toBe(DOMAIN);
    expect(verdict.selector).toBe(SELECTOR);
  });

  it("passes under simple/simple canonicalization too", async () => {
    const verdict = await verifyDkim(
      encode(await signedMessage({ canonicalization: "simple/simple" })),
      { lookupKeyRecords: keyLookup() },
    );
    expect(verdict.verdict).toBe("pass");
  });

  it("fails when the body changed after signing", async () => {
    const message = (await signedMessage()).replace("Hello there.", "Goodbye there.");
    const verdict = await verifyDkim(encode(message), { lookupKeyRecords: keyLookup() });
    expect(verdict.verdict).toBe("fail");
    expect(verdict.reason).toBe("bodyHashMismatch");
  });

  it("fails when a signed header changed but the body did not", async () => {
    const message = (await signedMessage()).replace("Subject: Hello", "Subject: Hello!");
    const verdict = await verifyDkim(encode(message), { lookupKeyRecords: keyLookup() });
    expect(verdict.verdict).toBe("fail");
    expect(verdict.reason).toBe("signatureMismatch");
  });

  // Unsigned mail is the common case for internal and older correspondence. It must record that no
  // question could be put, never a failure — a firm reading "fail" beside an ordinary internal email
  // would be misled about it.
  it("records unsigned mail as unverified, not failed", async () => {
    const message = "From: a@example.test\r\nSubject: Plain\r\n\r\nNo signature here.\r\n";
    const verdict = await verifyDkim(encode(message), { lookupKeyRecords: keyLookup() });
    expect(verdict.verdict).toBe("unverified");
    expect(verdict.reason).toBe("unsigned");
  });

  it("records bytes that are not a message as unverified with noRawMessage", async () => {
    const verdict = await verifyDkim(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
      lookupKeyRecords: keyLookup(),
    });
    expect(verdict.verdict).toBe("unverified");
    expect(verdict.reason).toBe("noRawMessage");
  });

  // A selector that has rotated away is ordinary for archived mail; it is not evidence against the
  // sender, so it stays unverified.
  it("records a missing key record as unverified, not failed", async () => {
    const verdict = await verifyDkim(encode(await signedMessage()), {
      lookupKeyRecords: keyLookup({ kind: "notFound" }),
    });
    expect(verdict.verdict).toBe("unverified");
    expect(verdict.reason).toBe("keyUnavailable");
  });

  // A resolver outage is our problem, not the sender's — recording it as a failure would defame them.
  it("records a resolver failure as unverified with a temporary reason", async () => {
    const verdict = await verifyDkim(encode(await signedMessage()), {
      lookupKeyRecords: keyLookup({ kind: "temporaryFailure" }),
    });
    expect(verdict.verdict).toBe("unverified");
    expect(verdict.reason).toBe("dnsTemporaryFailure");
  });

  // An empty p= is the signer explicitly revoking the key — a statement about the signature, so it is
  // a definite failure rather than an inconclusive one.
  it("fails on an explicitly revoked key", async () => {
    const verdict = await verifyDkim(encode(await signedMessage()), {
      lookupKeyRecords: keyLookup({ kind: "records", records: ["v=DKIM1; k=rsa; p="] }),
    });
    expect(verdict.verdict).toBe("fail");
    expect(verdict.reason).toBe("keyRevoked");
  });

  it("refuses a retired signing algorithm rather than vouching for it", async () => {
    const verdict = await verifyDkim(encode(await signedMessage({ algorithm: "rsa-sha1" })), {
      lookupKeyRecords: keyLookup(),
    });
    expect(verdict.verdict).toBe("unverified");
    expect(verdict.reason).toBe("unsupportedAlgorithm");
  });

  it("fails a signature whose own expiry has passed", async () => {
    const message = await signedMessage({ extraTags: "x=1000; " });
    const verdict = await verifyDkim(encode(message), {
      lookupKeyRecords: keyLookup(),
      nowSeconds: () => 2000,
    });
    expect(verdict.verdict).toBe("fail");
    expect(verdict.reason).toBe("signatureExpired");
  });

  it("honours an unexpired x= tag", async () => {
    const message = await signedMessage({ extraTags: "x=9999999999; " });
    const verdict = await verifyDkim(encode(message), {
      lookupKeyRecords: keyLookup(),
      nowSeconds: () => 2000,
    });
    expect(verdict.verdict).toBe("pass");
  });

  it("reads a key record split across several TXT strings", async () => {
    const verdict = await verifyDkim(encode(await signedMessage()), {
      lookupKeyRecords: async () => ({ kind: "records", records: [publicKeyRecord] }),
    });
    expect(verdict.verdict).toBe("pass");
  });

  // A forwarded copy is the forward/CC entrance's normal input: the hop rewrites headers, and the
  // original signature no longer verifies. The record must still be captured; only the verdict moves.
  it("fails a forwarded copy whose signed headers were rewritten, without losing the message", async () => {
    const forwarded = (await signedMessage()).replace(
      "To: Bob <bob@example.test>",
      "To: capture@in.example.test",
    );
    const verdict = await verifyDkim(encode(forwarded), { lookupKeyRecords: keyLookup() });
    expect(verdict.verdict).toBe("fail");
    expect(verdict.signingDomain).toBe(DOMAIN);
  });

  it("ignores a key record published for a different algorithm", async () => {
    const verdict = await verifyDkim(encode(await signedMessage()), {
      lookupKeyRecords: keyLookup({
        kind: "records",
        records: ["v=DKIM1; k=ed25519; p=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="],
      }),
    });
    expect(verdict.verdict).toBe("unverified");
    expect(verdict.reason).toBe("keyUnavailable");
  });

  it("takes the passing signature when a message carries more than one", async () => {
    const signed = await signedMessage();
    // A second, junk signature ahead of the real one: one verifying signature is enough.
    const withDecoy =
      "DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=decoy.test; s=sel; " +
      "h=from:to:subject; bh=AAAA; b=AAAA\r\n" +
      signed;
    const verdict = await verifyDkim(encode(withDecoy), { lookupKeyRecords: keyLookup() });
    expect(verdict.verdict).toBe("pass");
    expect(verdict.signingDomain).toBe(DOMAIN);
  });
});
