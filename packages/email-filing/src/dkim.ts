// DKIM verification for a captured message (RFC 6376), plus the Ed25519 signing algorithm RFC 8463
// adds. The parse engine records DKIM-Signature / Authentication-Results / Received verbatim and
// attaches no verdict — that is deliberately its boundary. This is the consumer that adjudicates
// them, and it lives here rather than in the parse engine so the engine stays a pure parser with no
// network reach: verification needs a DNS lookup of the signer's public key, which is I/O.
//
// Everything here is pure over its inputs except that one lookup, which arrives as a port. The
// cryptography is WebCrypto (`crypto.subtle`) — present in Workers and in Node — so there is no new
// dependency and nothing memory-unsafe parsing hostile bytes.
//
// THE VERDICT IS INFORMATIONAL. Nothing is dropped, quarantined, refused, or auto-filed on the
// strength of it. A signature that does not verify is a fact recorded beside the message, for a
// person to weigh; captured mail is kept either way, which is why every failure mode below resolves
// to a recorded reason rather than an exception. Forwarding a message rewrites headers and usually
// breaks the original signature, so a `forward`-captured message failing verification is expected and
// says nothing bad about the sender — the reason code plus the row's `captured_via` is what makes
// that distinction readable.

/** The coarse verdict stored on the message row. */
export type DkimVerdict = "unverified" | "pass" | "fail";

/**
 * Why the message holds the verdict it holds. `pass`/`fail` are cryptographic outcomes; every other
 * reason resolves to `unverified`, which is the honest answer when the question could not be put.
 */
export type DkimVerdictReason =
  | "passed" // a signature verified
  | "unsigned" // the message carries no DKIM-Signature header
  | "noRawMessage" // the capture has no RFC 5322 bytes to canonicalize (a .msg export)
  | "malformedSignature" // the DKIM-Signature header could not be read
  | "unsupportedAlgorithm" // a signing or hash algorithm this verifier does not implement
  | "bodyHashMismatch" // the body changed after signing
  | "signatureMismatch" // the signature does not verify against the signed headers
  | "signatureExpired" // the signature's own x= expiry had passed at capture time
  | "keyRevoked" // the signer published an empty key (an explicit revocation)
  | "keyUnavailable" // no usable key record for the selector
  | "dnsTemporaryFailure"; // the key lookup failed in a way that may succeed later

export interface DkimVerification {
  readonly verdict: DkimVerdict;
  readonly reason: DkimVerdictReason;
  /** The `d=` domain of the signature that produced the verdict, when there was one. */
  readonly signingDomain: string | null;
  /** The `s=` selector of that signature. */
  readonly selector: string | null;
}

/** The outcome of looking up a selector's key record. Distinguishing "no record" from "lookup broke"
 * is what keeps a resolver outage from being recorded as a signer's failure. */
export type DkimKeyLookupResult =
  | { readonly kind: "records"; readonly records: readonly string[] }
  | { readonly kind: "notFound" }
  | { readonly kind: "temporaryFailure" };

/** Resolve the TXT records at `<selector>._domainkey.<domain>`. */
export type DkimKeyLookup = (name: string) => Promise<DkimKeyLookupResult>;

export interface DkimVerifyOptions {
  readonly lookupKeyRecords: DkimKeyLookup;
  /** Epoch seconds, for the `x=` expiry check. Defaults to the wall clock. */
  readonly nowSeconds?: () => number;
}

/** The verdict a message carries when nothing has adjudicated it. */
export const UNVERIFIED: DkimVerification = {
  verdict: "unverified",
  reason: "unsigned",
  signingDomain: null,
  selector: null,
};

const CRLF = "\r\n";
const HEADER_BODY_SEPARATOR = CRLF + CRLF;

/**
 * Verify the DKIM signatures on one raw RFC 5322 message.
 *
 * A message may carry several signatures (a sender's own plus a mailing list's, say). One verifying
 * signature is enough, so the first `pass` wins; when none pass, the first signature's outcome is
 * reported, since that is the one nearest the message's own origin.
 */
export async function verifyDkim(
  raw: Uint8Array,
  options: DkimVerifyOptions,
): Promise<DkimVerification> {
  const text = bytesToBinaryString(raw);
  const separator = text.indexOf(HEADER_BODY_SEPARATOR);
  // No header/body boundary at all means these bytes are not an RFC 5322 message; there is nothing
  // to canonicalize, which is a different statement from "the signature is bad".
  if (separator === -1) {
    return { verdict: "unverified", reason: "noRawMessage", signingDomain: null, selector: null };
  }
  const headerBlock = text.slice(0, separator);
  const body = text.slice(separator + HEADER_BODY_SEPARATOR.length);
  const fields = splitHeaderFields(headerBlock);

  const signatureFields = fields.filter((field) => field.lowerName === "dkim-signature");
  if (signatureFields.length === 0) {
    return { verdict: "unverified", reason: "unsigned", signingDomain: null, selector: null };
  }

  let first: DkimVerification | null = null;
  for (const field of signatureFields) {
    const outcome = await verifyOneSignature(field, fields, body, options);
    if (outcome.verdict === "pass") return outcome;
    first ??= outcome;
  }
  return first ?? UNVERIFIED;
}

async function verifyOneSignature(
  signatureField: HeaderField,
  fields: readonly HeaderField[],
  body: string,
  options: DkimVerifyOptions,
): Promise<DkimVerification> {
  const parsed = parseTagList(signatureField.value);
  const tags = parsed.tags;
  const domain = tags.get("d") ?? null;
  const selector = tags.get("s") ?? null;
  const at = (
    reason: DkimVerdictReason,
    verdict: DkimVerdict = "unverified",
  ): DkimVerification => ({
    verdict,
    reason,
    signingDomain: domain,
    selector,
  });

  const signature = tags.get("b");
  const bodyHash = tags.get("bh");
  const algorithm = tags.get("a");
  const signedHeaders = tags.get("h");
  const signatureSpan = parsed.spans.get("b");
  if (
    domain === null ||
    selector === null ||
    signature === undefined ||
    bodyHash === undefined ||
    algorithm === undefined ||
    signedHeaders === undefined ||
    signatureSpan === undefined
  ) {
    return at("malformedSignature");
  }

  const signing = parseAlgorithm(algorithm);
  if (signing === null) return at("unsupportedAlgorithm");

  const expiry = tags.get("x");
  if (expiry !== undefined) {
    const expirySeconds = Number(expiry);
    const nowSeconds = (options.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))();
    // The signer set its own shelf life and it has passed. Reported as a definite failure because the
    // signer said so, not because the cryptography disagreed.
    if (Number.isFinite(expirySeconds) && expirySeconds < nowSeconds) {
      return at("signatureExpired", "fail");
    }
  }

  const { headerCanonicalization, bodyCanonicalization } = parseCanonicalization(tags.get("c"));

  // 1. The body hash. Checked first: it needs no DNS, and a body that changed after signing settles
  // the question without spending a lookup on it.
  const lengthLimit = parseLengthLimit(tags.get("l"));
  const canonicalBody = canonicalizeBody(body, bodyCanonicalization, lengthLimit);
  const computedBodyHash = await sha256Base64(binaryStringToBytes(canonicalBody));
  if (computedBodyHash !== bodyHash) return at("bodyHashMismatch", "fail");

  // 2. The signed header set, in the order the h= tag lists them. A name listed more than once refers
  // to successively earlier instances of that header (RFC 6376's bottom-up rule), and a name listed
  // but absent from the message contributes nothing — which is exactly how a signer protects against
  // a header being ADDED after signing.
  const signedInput = buildSignedHeaderInput(
    signedHeaders,
    fields,
    signatureField,
    signatureSpan,
    headerCanonicalization,
  );

  // 3. The signer's public key.
  const lookup = await options.lookupKeyRecords(`${selector}._domainkey.${domain}`);
  if (lookup.kind === "temporaryFailure") return at("dnsTemporaryFailure");
  if (lookup.kind === "notFound") return at("keyUnavailable");
  const keyRecord = selectKeyRecord(lookup.records, signing.keyType);
  if (keyRecord === null) return at("keyUnavailable");
  // An explicitly empty p= is the RFC's revocation signal: the signer is saying this key must no
  // longer validate anything. That is a statement about the signature, so it is a definite failure —
  // unlike a selector that has simply rotated away, which leaves no record at all.
  if (keyRecord.publicKey === "") return at("keyRevoked", "fail");

  const verified = await verifySignature(
    signing,
    keyRecord.publicKey,
    signature,
    binaryStringToBytes(signedInput),
  );
  if (verified === null) return at("unsupportedAlgorithm");
  return verified ? at("passed", "pass") : at("signatureMismatch", "fail");
}

// ── Header fields

interface HeaderField {
  readonly name: string;
  readonly lowerName: string;
  /** The field value, everything after the first colon, still folded. */
  readonly value: string;
  /** The whole field as written, folded, with no trailing CRLF. */
  readonly raw: string;
}

/**
 * Split a header block into fields, joining continuation lines back onto the field they continue. The
 * folding is preserved in `raw` because the simple canonicalization hashes headers exactly as written.
 */
function splitHeaderFields(headerBlock: string): HeaderField[] {
  const fields: HeaderField[] = [];
  let current: string | null = null;
  for (const line of headerBlock.split(CRLF)) {
    if (current !== null && (line.startsWith(" ") || line.startsWith("\t"))) {
      current += CRLF + line;
      continue;
    }
    if (current !== null) fields.push(toHeaderField(current));
    current = line;
  }
  if (current !== null && current !== "") fields.push(toHeaderField(current));
  return fields;
}

function toHeaderField(raw: string): HeaderField {
  const colon = raw.indexOf(":");
  const name = colon === -1 ? raw : raw.slice(0, colon);
  return {
    name,
    lowerName: name.trim().toLowerCase(),
    value: colon === -1 ? "" : raw.slice(colon + 1),
    raw,
  };
}

function buildSignedHeaderInput(
  signedHeaders: string,
  fields: readonly HeaderField[],
  signatureField: HeaderField,
  signatureSpan: TagSpan,
  canonicalization: Canonicalization,
): string {
  // Bottom-up: each h= entry consumes the next-lowest instance of that header, so a signer that lists
  // "received:received" signs the two most recent Received lines.
  const remaining = new Map<string, HeaderField[]>();
  for (const field of fields) {
    const bucket = remaining.get(field.lowerName);
    if (bucket === undefined) remaining.set(field.lowerName, [field]);
    else bucket.push(field);
  }
  for (const bucket of remaining.values()) bucket.reverse();

  let input = "";
  for (const entry of signedHeaders.split(":")) {
    const wanted = entry.trim().toLowerCase();
    if (wanted === "") continue;
    const field = remaining.get(wanted)?.shift();
    if (field === undefined) continue; // listed but absent — contributes nothing, per the RFC
    input += canonicalizeHeader(field, canonicalization);
  }

  // The DKIM-Signature header signs itself, with its own b= value emptied and no trailing CRLF.
  const withoutSignature: HeaderField = {
    ...signatureField,
    value:
      signatureField.value.slice(0, signatureSpan.start) +
      signatureField.value.slice(signatureSpan.end),
    raw: "",
  };
  const rebuilt: HeaderField = {
    ...withoutSignature,
    raw: `${signatureField.name}:${withoutSignature.value}`,
  };
  return input + canonicalizeHeader(rebuilt, canonicalization).slice(0, -CRLF.length);
}

type Canonicalization = "simple" | "relaxed";

function canonicalizeHeader(field: HeaderField, canonicalization: Canonicalization): string {
  if (canonicalization === "simple") return field.raw + CRLF;
  const unfolded = field.value.replace(/\r\n/g, "");
  const collapsed = unfolded.replace(/[ \t]+/g, " ").trim();
  return `${field.lowerName}:${collapsed}${CRLF}`;
}

// ── Body canonicalization

function canonicalizeBody(
  body: string,
  canonicalization: Canonicalization,
  lengthLimit: number | null,
): string {
  const canonical =
    canonicalization === "simple" ? canonicalizeBodySimple(body) : canonicalizeBodyRelaxed(body);
  // The l= tag signs only a prefix of the body. Honouring it is what lets the signature verify at all
  // on a message a list appended a footer to; the bytes past the limit are simply unsigned.
  return lengthLimit === null ? canonical : canonical.slice(0, lengthLimit);
}

function canonicalizeBodySimple(body: string): string {
  // Trailing empty lines collapse to exactly one CRLF, and an empty body canonicalizes to one CRLF.
  const trimmed = body.replace(/(\r\n)*$/, "");
  return trimmed + CRLF;
}

function canonicalizeBodyRelaxed(body: string): string {
  const lines = body.split(CRLF).map((line) => line.replace(/[ \t]+/g, " ").replace(/[ \t]+$/, ""));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  // A wholly empty body canonicalizes to nothing at all here — not to a bare CRLF, which is the one
  // place the two body algorithms genuinely disagree.
  if (lines.length === 0) return "";
  return lines.join(CRLF) + CRLF;
}

// ── Tag lists (the signature header and the DNS key record share the grammar)

interface TagSpan {
  readonly start: number;
  readonly end: number;
}

interface TagList {
  readonly tags: ReadonlyMap<string, string>;
  /** Where each tag's value sits in the source text, so a value can be spliced out byte-exactly. */
  readonly spans: ReadonlyMap<string, TagSpan>;
}

/**
 * Parse `tag=value; tag=value` into a map. Folding whitespace is stripped from values: it is
 * insignificant inside base64 and inside the colon-separated h= list, and every tag this verifier
 * reads is one of those or a bare token.
 */
function parseTagList(text: string): TagList {
  const tags = new Map<string, string>();
  const spans = new Map<string, TagSpan>();
  let cursor = 0;
  while (cursor <= text.length) {
    let end = text.indexOf(";", cursor);
    if (end === -1) end = text.length;
    const segment = text.slice(cursor, end);
    const equals = segment.indexOf("=");
    if (equals !== -1) {
      const name = segment.slice(0, equals).trim();
      if (name !== "" && !tags.has(name)) {
        tags.set(name, stripWhitespace(segment.slice(equals + 1)));
        spans.set(name, { start: cursor + equals + 1, end });
      }
    }
    cursor = end + 1;
  }
  return { tags, spans };
}

function stripWhitespace(value: string): string {
  return value.replace(/[ \t\r\n]+/g, "");
}

function parseCanonicalization(tag: string | undefined): {
  headerCanonicalization: Canonicalization;
  bodyCanonicalization: Canonicalization;
} {
  // The c= tag defaults to simple/simple, and a bare "relaxed" means relaxed headers with a simple
  // body — the asymmetry is in the RFC, not a typo.
  const [header, body] = (tag ?? "simple/simple").split("/");
  return {
    headerCanonicalization: header === "relaxed" ? "relaxed" : "simple",
    bodyCanonicalization: body === "relaxed" ? "relaxed" : "simple",
  };
}

function parseLengthLimit(tag: string | undefined): number | null {
  if (tag === undefined) return null;
  const value = Number(tag);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

interface SigningAlgorithm {
  readonly keyType: "rsa" | "ed25519";
  readonly hash: "SHA-256";
}

function parseAlgorithm(tag: string): SigningAlgorithm | null {
  // rsa-sha1 is deliberately absent: RFC 8301 retired it, and accepting it would let a signer claim a
  // pass this platform should not vouch for.
  if (tag === "rsa-sha256") return { keyType: "rsa", hash: "SHA-256" };
  if (tag === "ed25519-sha256") return { keyType: "ed25519", hash: "SHA-256" };
  return null;
}

// ── The DNS key record

interface KeyRecord {
  readonly publicKey: string;
  readonly keyType: "rsa" | "ed25519";
}

function selectKeyRecord(records: readonly string[], wanted: "rsa" | "ed25519"): KeyRecord | null {
  for (const record of records) {
    const { tags } = parseTagList(record);
    const publicKey = tags.get("p");
    if (publicKey === undefined) continue;
    const keyType = tags.get("k") ?? "rsa"; // the k= tag defaults to rsa
    if (keyType !== "rsa" && keyType !== "ed25519") continue;
    if (keyType !== wanted) continue;
    return { publicKey, keyType };
  }
  return null;
}

/**
 * Verify one signature. Returns null — not false — when the runtime cannot import the key at all, so
 * a runtime without Ed25519 records `unsupportedAlgorithm` rather than accusing the signer of a bad
 * signature.
 */
async function verifySignature(
  algorithm: SigningAlgorithm,
  publicKeyBase64: string,
  signatureBase64: string,
  signedInput: Uint8Array,
): Promise<boolean | null> {
  let signature: Uint8Array;
  let publicKey: Uint8Array;
  try {
    signature = base64ToBytes(signatureBase64);
    publicKey = base64ToBytes(publicKeyBase64);
  } catch {
    return false;
  }

  try {
    if (algorithm.keyType === "rsa") {
      const key = await crypto.subtle.importKey(
        "spki",
        toArrayBuffer(publicKey),
        { name: "RSASSA-PKCS1-v1_5", hash: algorithm.hash },
        false,
        ["verify"],
      );
      return await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        key,
        toArrayBuffer(signature),
        toArrayBuffer(signedInput),
      );
    }
    // RFC 8463 publishes the Ed25519 key as the bare 32-byte point, not as SPKI.
    const key = await crypto.subtle.importKey(
      "raw",
      toArrayBuffer(publicKey),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "Ed25519",
      key,
      toArrayBuffer(signature),
      toArrayBuffer(signedInput),
    );
  } catch {
    return null;
  }
}

// ── Byte/text plumbing. DKIM canonicalizes octets, so every string here is a 1:1 byte string
// (one code unit per octet) rather than decoded text — an 8-bit body must survive untouched.

const BINARY_CHUNK = 0x8000;

export function bytesToBinaryString(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += BINARY_CHUNK) {
    out += String.fromCharCode(...bytes.subarray(index, index + BINARY_CHUNK));
  }
  return out;
}

export function binaryStringToBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
  return bytes;
}

function base64ToBytes(value: string): Uint8Array {
  return binaryStringToBytes(atob(value));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function sha256Base64(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return btoa(bytesToBinaryString(new Uint8Array(digest)));
}
