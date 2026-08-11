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
  /** The h= list, and therefore which headers the canonical input is built from. */
  readonly signedHeaders?: readonly string[];
  /** Extra header lines placed ABOVE the standard three, for the duplicate-header cases. */
  readonly prefixHeaders?: readonly string[];
  /** The canonical body actually hashed, when it differs from the body sent (the l= cases). */
  readonly hashedBody?: string;
  /** Sign and verify with this key record instead of the generated 2048-bit one. */
  readonly keyRecord?: string;
  readonly signingKey?: CryptoKey;
}

/**
 * Build a signed message. The canonical forms below are written out literally, which is only tractable
 * because the message is deliberately trivial: three single-line headers and a one-line body.
 */
async function signedMessage(options: SignOptions = {}): Promise<string> {
  const algorithm = options.algorithm ?? "rsa-sha256";
  const canonicalization = options.canonicalization ?? "relaxed/relaxed";
  const body = options.body ?? BODY;
  const signedHeaders = options.signedHeaders ?? ["from", "to", "subject"];
  const prefixHeaders = options.prefixHeaders ?? [];
  const headers = [
    ...prefixHeaders,
    "From: Alice <alice@example.test>",
    "To: Bob <bob@example.test>",
    "Subject: Hello",
  ];

  // The relaxed canonical form of each header this suite knows how to sign, keyed by h= name. Written
  // out rather than derived, so a canonicalization bug cannot cancel itself out on both sides.
  const relaxedByName: Record<string, string> = {
    from: "from:Alice <alice@example.test>",
    to: "to:Bob <bob@example.test>",
    subject: "subject:Hello",
  };

  // Body canonicalization. Relaxed drops the trailing empty line and leaves one CRLF; simple does the
  // same for this body, since it has no trailing whitespace and exactly one terminating CRLF. When
  // `hashedBody` is given the signature covers only that prefix, which is what l= means.
  const bodyHash = await sha256Base64(options.hashedBody ?? body);

  const tags =
    `v=1; a=${algorithm}; c=${canonicalization}; d=${DOMAIN}; s=${SELECTOR}; ` +
    `h=${signedHeaders.join(":")}; ${options.extraTags ?? ""}bh=${bodyHash}; b=`;

  const canonicalHeaders =
    canonicalization === "relaxed/relaxed"
      ? signedHeaders.map((name) => `${relaxedByName[name] ?? `${name}:`}\r\n`).join("") +
        `dkim-signature:${tags}`
      : `${headers.join("\r\n")}\r\n` + `DKIM-Signature: ${tags}`;

  const signature = bytesToBase64(
    new Uint8Array(
      await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        options.signingKey ?? privateKey,
        encode(canonicalHeaders),
      ),
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

// ---------------------------------------------------------------------------------------------
// What a `pass` is allowed to mean
// ---------------------------------------------------------------------------------------------

describe("the From requirement", () => {
  // RFC 6376 section 5.4: "The From header field MUST be signed (that is, included in the 'h=' tag of
  // the resulting DKIM-Signature header field)." Without it the cryptography still verifies and the
  // verdict says nothing about who sent the message — which is the whole basis a sender-identity rule
  // files on.
  it("refuses a signature whose h= omits From, however well the cryptography verifies", async () => {
    const message = await signedMessage({ signedHeaders: ["to", "subject"] });
    const verdict = await verifyDkim(encode(message), { lookupKeyRecords: keyLookup() });
    expect(verdict.verdict).toBe("fail");
    expect(verdict.reason).toBe("fromNotSigned");
    expect(verdict.signingDomain).toBe(DOMAIN);
  });

  it("refuses before spending a DNS lookup on it", async () => {
    let lookups = 0;
    const message = await signedMessage({ signedHeaders: ["to", "subject"] });
    await verifyDkim(encode(message), {
      lookupKeyRecords: async (name) => {
        lookups += 1;
        return keyLookup()(name);
      },
    });
    expect(lookups).toBe(0);
  });

  it("records the covered header names on a pass, so a gate need not re-parse the signature", async () => {
    const verdict = await verifyDkim(encode(await signedMessage()), {
      lookupKeyRecords: keyLookup(),
    });
    expect(verdict.verdict).toBe("pass");
    expect(verdict.signedHeaderNames).toEqual(["from", "to", "subject"]);
  });

  // THE DUPLICATE-FROM ALIGNMENT. RFC 6376 section 5.4.2 makes a signer sign the physically LAST
  // instance of a repeated header, and this verifier implements that bottom-up rule. The capture
  // record stores the last instance too (pinned in crates/email-core/src/eml.rs), so a pass vouches
  // for the same sender a person is shown. These two cases are what keep the pair aligned: signing the
  // last instance verifies, and a signature over the first does not.
  it("validates the LAST From instance, which is the one the capture record stores", async () => {
    const message = await signedMessage({
      prefixHeaders: ["From: Mallory <mallory@attacker.example>"],
    });
    const verdict = await verifyDkim(encode(message), { lookupKeyRecords: keyLookup() });
    expect(verdict.verdict).toBe("pass");
  });

  // The attack the alignment closes. An attacker takes a legitimately signed message and adds their
  // own From BELOW the signed one, making theirs the last instance — the one the capture record will
  // store and show. Because the verifier reads the same last instance, the signed input no longer
  // matches what the signer covered and the signature stops verifying. The message is still captured;
  // it just cannot claim to be authenticated.
  it("fails when a From is appended below the signed one, so the displayed sender is never unvouched", async () => {
    const legitimate = await signedMessage();
    const spoofed = legitimate.replace(
      "Subject: Hello\r\n\r\n",
      "Subject: Hello\r\nFrom: Mallory <mallory@attacker.example>\r\n\r\n",
    );
    const verdict = await verifyDkim(encode(spoofed), { lookupKeyRecords: keyLookup() });
    expect(verdict.verdict).toBe("fail");
    expect(verdict.reason).toBe("signatureMismatch");
  });
});

describe("how much of the body a pass covers", () => {
  it("reports full coverage when the signature carries no l=", async () => {
    const verdict = await verifyDkim(encode(await signedMessage()), {
      lookupKeyRecords: keyLookup(),
    });
    expect(verdict.verdict).toBe("pass");
    expect(verdict.bodyFullyCovered).toBe(true);
  });

  // The append attack: the signature covers a prefix, so anyone holding a legitimately signed message
  // can add content past l= and it still verifies. The verdict stays an honest `pass` — the
  // cryptography did pass — and the coverage flag is what lets the auto-file gate decline it.
  it("reports partial coverage when l= signs only a prefix of the body", async () => {
    const signedPrefix = "Hello there.\r\n";
    const appended = `${signedPrefix}Wire the funds to account 12345.\r\n`;
    const message = await signedMessage({
      body: appended,
      hashedBody: signedPrefix,
      extraTags: `l=${signedPrefix.length}; `,
    });
    const verdict = await verifyDkim(encode(message), { lookupKeyRecords: keyLookup() });
    expect(verdict.verdict).toBe("pass");
    expect(verdict.bodyFullyCovered).toBe(false);
  });
});

describe("the per-message cost bounds", () => {
  // `bh` is a plain SHA-256 of the canonical body, so anyone with the body can compute a correct one
  // and attach it to a thousand DKIM-Signature headers with distinct d=/s= values. Each survivor would
  // otherwise cost a digest over the whole body plus an outbound DNS-over-HTTPS request.
  it("examines at most three signatures however many the message carries", async () => {
    let lookups = 0;
    const decoys = Array.from(
      { length: 50 },
      (_unused, index) =>
        `DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=decoy${index}.test; ` +
        `s=sel${index}; h=from:to:subject; bh=AAAA; b=AAAA`,
    ).join("\r\n");
    const message = `${decoys}\r\n${await signedMessage()}`;
    const verdict = await verifyDkim(encode(message), {
      lookupKeyRecords: async (name) => {
        lookups += 1;
        return keyLookup()(name);
      },
    });
    // Every decoy fails its body hash before any lookup, and the real signature is past the cap — so
    // the message resolves without the resolver being asked fifty times.
    expect(lookups).toBeLessThanOrEqual(3);
    expect(verdict.verdict).not.toBe("pass");
  });

  it("caps the DNS lookups one message may cause", async () => {
    let lookups = 0;
    const bodyHash = await sha256Base64(BODY);
    // Correct body hashes, so each one survives to the lookup — the amplifier the cap exists for.
    const decoys = Array.from(
      { length: 20 },
      (_unused, index) =>
        `DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=decoy${index}.test; ` +
        `s=sel${index}; h=from:to:subject; bh=${bodyHash}; b=AAAA`,
    ).join("\r\n");
    const message = `${decoys}\r\n${await signedMessage()}`;
    await verifyDkim(encode(message), {
      lookupKeyRecords: async (name) => {
        lookups += 1;
        return keyLookup()(name);
      },
    });
    expect(lookups).toBeLessThanOrEqual(3);
  });
});

describe("what the key record is allowed to vouch for", () => {
  // RFC 6376 section 3.6.1: a verifier must not treat a message from a signer in testing mode
  // differently from an unsigned one.
  it("declines to pass on a key record marked t=y", async () => {
    const verdict = await verifyDkim(encode(await signedMessage()), {
      lookupKeyRecords: keyLookup({
        kind: "records",
        records: [`${publicKeyRecord}; t=y`],
      }),
    });
    expect(verdict.verdict).toBe("unverified");
    expect(verdict.reason).toBe("keyTesting");
  });

  it("reads t= as a flag list, so t=s:y is still testing", async () => {
    const verdict = await verifyDkim(encode(await signedMessage()), {
      lookupKeyRecords: keyLookup({ kind: "records", records: [`${publicKeyRecord}; t=s:y`] }),
    });
    expect(verdict.reason).toBe("keyTesting");
  });

  it("still passes on a record whose t= carries only other flags", async () => {
    const verdict = await verifyDkim(encode(await signedMessage()), {
      lookupKeyRecords: keyLookup({ kind: "records", records: [`${publicKeyRecord}; t=s`] }),
    });
    expect(verdict.verdict).toBe("pass");
  });

  // RFC 8301 requires rejecting RSA keys under 1024 bits. `importKey` accepts a 512-bit SPKI happily,
  // so the size is read back off the imported key rather than assumed.
  it("refuses an RSA key below 1024 bits", async () => {
    const weak = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 512,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const spki = await crypto.subtle.exportKey("spki", weak.publicKey);
    const record = `v=DKIM1; k=rsa; p=${bytesToBase64(new Uint8Array(spki))}`;
    const message = await signedMessage({ signingKey: weak.privateKey });
    const verdict = await verifyDkim(encode(message), {
      lookupKeyRecords: keyLookup({ kind: "records", records: [record] }),
    });
    expect(verdict.verdict).toBe("fail");
    expect(verdict.reason).toBe("keyTooWeak");
  });

  // Number("abc") is NaN and Number.isFinite(NaN) is false, so the old reading simply dropped the
  // expiry — the one interpretation that favours whoever wrote the tag.
  it("treats a non-numeric x= as a malformed signature rather than as no expiry", async () => {
    const message = await signedMessage({ extraTags: "x=whenever; " });
    const verdict = await verifyDkim(encode(message), { lookupKeyRecords: keyLookup() });
    expect(verdict.reason).toBe("malformedSignature");
  });

  it("still enforces a numeric x= that has passed", async () => {
    const message = await signedMessage({ extraTags: "x=1000; " });
    const verdict = await verifyDkim(encode(message), {
      lookupKeyRecords: keyLookup(),
      nowSeconds: () => 2000,
    });
    expect(verdict.verdict).toBe("fail");
    expect(verdict.reason).toBe("signatureExpired");
  });
});
