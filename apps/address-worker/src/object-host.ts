// THE OBJECT HOST — the R2 side of the address engine.
//
// The engine (containers/address) holds no credential and has no internet. It reads and writes its
// index by calling an ordinary HTTP host that does not exist on any network; the container's outbound
// interception (src/address-index-container.ts, src/address-build-container.ts) hands each call to this
// module inside the Workers runtime, and this module turns it into one R2 operation on the worker's
// ADDRESS_INDEX binding.
//
// Pure: no container, no runtime global beyond the web platform, and the bucket and the stream helper
// are handed in, so the whole surface is exercised in the node pool against an in-memory bucket.
//
// THE ONE RULE: it performs exactly the operation the engine asked for, and nothing else. No
// read-ahead, no whole-object fetch behind a ranged read, no buffering of a split on its way through.
// Every ranged read is an R2 read operation, and the engine's read count per keystroke is what the cost
// of this feature was measured on. An unranged read of a split is therefore REFUSED rather than served
// whole: making the expensive shape inexpressible is what keeps it from appearing by accident. The two
// small objects that are read whole (the pointer and the attribution manifest) ask for it by name, and
// are refused above a mebibyte.
//
// Nothing here logs, and no refusal body names a key: an object key carries a build identifier and a
// partition, which is harmless, but the habit of keeping request detail out of error bodies is the one
// that keeps a query or an address out of them elsewhere in this engine.

// The non-routable host the engine addresses its object calls to. It MUST stay in sync with the
// container's own constant (containers/address) — change one and change the other in the same commit,
// or every engine read leaves the container as egress and is refused.
export const ADDRESS_OBJECT_HOST = "addresses.magna-carta.internal";

// The ceiling for an object written or read whole: the pointer and the attribution manifest are a few
// kilobytes, so a mebibyte is generous for them and far below anything a split could be mistaken for.
export const SMALL_OBJECT_LIMIT_BYTES = 1024 * 1024;

// The size of every multipart part but the last. R2 requires all parts but the last to be the same
// size; the engine streams a split in parts of exactly this size, so anything larger is not one of its
// parts and is refused before a byte reaches storage.
export const MULTIPART_PART_SIZE_BYTES = 64 * 1024 * 1024;

// R2's own bounds on a part number.
const LOWEST_PART_NUMBER = 1;
const HIGHEST_PART_NUMBER = 10_000;

// The header that asks for a small object whole, and the one value it accepts.
export const WHOLE_OBJECT_HEADER = "x-mc-whole";
export const WHOLE_OBJECT_SMALL = "small";

// The object's total size on a HEAD, beside content-length. A runtime is entitled to rewrite
// content-length on a bodyless response, and a range reader that cannot learn the true length cannot
// find a split's footer at its tail; one of the two always survives the trip back to the container.
export const OBJECT_SIZE_HEADER = "x-mc-object-size";

// The subset of the R2 binding this host uses. The worker passes its real ADDRESS_INDEX binding; the
// tests pass an in-memory bucket that implements exactly this.
export type AddressObjectBucket = Pick<
  R2Bucket,
  "head" | "get" | "put" | "delete" | "createMultipartUpload" | "resumeMultipartUpload"
>;

// What a container may do through the host. The query container only reads — it opens the pointer and
// range-reads the partitions — so it is given no way to write, upload or delete; only the build
// container publishes.
export type ObjectHostAccess = "read" | "read-write";

export interface ObjectHostOptions {
  readonly bucket: AddressObjectBucket;
  readonly access: ObjectHostAccess;
  // Wrap a streamed part body so R2 knows its length up front. R2 refuses a stream of unknown length,
  // and a body that has crossed the interception boundary is not guaranteed to carry one; in the
  // runtime this is a FixedLengthStream (fixedLengthBody below), which also fails the upload if the
  // bytes that arrive differ from the declared length. The tests pass the body through unchanged.
  readonly knownLength: (body: ReadableStream<Uint8Array>, length: number) => ReadableStream;
}

// The runtime's knownLength: pipe the body through a FixedLengthStream of the declared length.
// pipeThrough marks its own pipe promise handled, and a length mismatch errors the readable side, which
// is what the upload awaits — so a short or long body fails the part rather than storing it.
export function fixedLengthBody(body: ReadableStream<Uint8Array>, length: number): ReadableStream {
  return body.pipeThrough(new FixedLengthStream(length));
}

// A key the engine may name: under a two-letter country, then only lowercase letters, digits and
// `/ . _ -`. Matched against the raw path, never a decoded one, so an escaped character is simply not
// a key. Traversal and empty segments are refused on top of the pattern: R2 keys are flat, so `..`
// would not climb anywhere, but a key that looks like it does is not one the engine ever writes.
const KEY_PATTERN = /^[a-z]{2}\/[a-z0-9/._-]+$/;

export function addressObjectKeyOf(candidate: string): string | null {
  if (!KEY_PATTERN.test(candidate)) return null;
  if (candidate.includes("..")) return null;
  if (candidate.split("/").some((segment) => segment === "")) return null;
  return candidate;
}

// A parsed `Range: bytes=<first>-<last>`. Only the single closed range is accepted: the engine asks
// for one exact span per read, so an open-ended, suffix or multi-range request is not something it
// emits and is refused rather than interpreted.
export interface ByteRange {
  readonly first: number;
  readonly last: number;
}

export function parseByteRange(header: string): ByteRange | null {
  const match = /^bytes=(\d+)-(\d+)$/.exec(header.trim());
  if (match === null) return null;
  const first = Number(match[1]);
  const last = Number(match[2]);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last < first) return null;
  return { first, last };
}

// Every refusal is a status and one word of engine vocabulary. Never a key, never a body.
function refuse(status: number, error: string, headers?: Record<string, string>): Response {
  return Response.json({ error }, { status, headers });
}

function notFound(): Response {
  return refuse(404, "not-found");
}

const OBJECTS_PREFIX = "/objects/";
const UPLOADS_PREFIX = "/uploads/";
const COMPLETE_SUFFIX = "/complete";

// Serve one intercepted object call. Any storage failure answers 502 with no detail: the engine treats
// it as a failed read or a failed build step, and the build's own failure path keeps the old pointer.
export async function serveObjectCall(
  request: Request,
  options: ObjectHostOptions,
): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (url.pathname.startsWith(OBJECTS_PREFIX)) {
      return await serveObjects(request, url, options);
    }
    if (url.pathname.startsWith(UPLOADS_PREFIX) && options.access === "read-write") {
      return await serveUploads(request, url, options);
    }
    return notFound();
  } catch {
    return refuse(502, "storage-error");
  }
}

async function serveObjects(
  request: Request,
  url: URL,
  options: ObjectHostOptions,
): Promise<Response> {
  const key = addressObjectKeyOf(url.pathname.slice(OBJECTS_PREFIX.length));
  if (key === null) return refuse(400, "bad-key");
  const { bucket } = options;

  if (request.method === "HEAD") return headObject(bucket, key);
  if (request.method === "GET") return getObject(request, bucket, key);
  if (options.access !== "read-write") return notFound();
  if (request.method === "PUT") return putSmallObject(request, bucket, key);
  if (request.method === "DELETE") {
    await bucket.delete(key);
    return new Response(null, { status: 204 });
  }
  return notFound();
}

async function headObject(bucket: AddressObjectBucket, key: string): Promise<Response> {
  const head = await bucket.head(key);
  if (head === null) return notFound();
  return new Response(null, {
    status: 200,
    headers: {
      "content-length": String(head.size),
      [OBJECT_SIZE_HEADER]: String(head.size),
      "accept-ranges": "bytes",
    },
  });
}

async function getObject(
  request: Request,
  bucket: AddressObjectBucket,
  key: string,
): Promise<Response> {
  const rangeHeader = request.headers.get("range");
  if (rangeHeader === null) {
    if (request.headers.get(WHOLE_OBJECT_HEADER) === WHOLE_OBJECT_SMALL) {
      return getSmallObject(bucket, key);
    }
    return refuse(416, "range-required", { "accept-ranges": "bytes" });
  }
  const range = parseByteRange(rangeHeader);
  if (range === null) return refuse(400, "range-malformed");

  const requestedLength = range.last - range.first + 1;
  let object: R2ObjectBody | null;
  try {
    object = await bucket.get(key, { range: { offset: range.first, length: requestedLength } });
  } catch (error) {
    // R2 refuses a range that starts past the end by throwing rather than answering. Only then is the
    // object's size worth a second operation: it is what tells an unsatisfiable range (416, which the
    // engine can act on) from a storage failure (502, which it cannot).
    const head = await bucket.head(key);
    if (head === null) return notFound();
    if (range.first >= head.size) return unsatisfiable(head.size);
    throw error;
  }
  if (object === null) return notFound();
  if (range.first >= object.size) {
    await object.body.cancel();
    return unsatisfiable(object.size);
  }
  // A range that runs past the end is served to the end, as HTTP ranges are: the engine asks for a
  // span and learns from content-range where the object actually stopped.
  const length = Math.min(requestedLength, object.size - range.first);
  const last = range.first + length - 1;
  // Streamed, never read into a buffer here: the bytes pass through and the worker holds none of them.
  return new Response(object.body, {
    status: 206,
    headers: {
      "content-length": String(length),
      "content-range": `bytes ${String(range.first)}-${String(last)}/${String(object.size)}`,
      "content-type": "application/octet-stream",
    },
  });
}

function unsatisfiable(size: number): Response {
  return refuse(416, "range-not-satisfiable", { "content-range": `bytes */${String(size)}` });
}

async function getSmallObject(bucket: AddressObjectBucket, key: string): Promise<Response> {
  const object = await bucket.get(key);
  if (object === null) return notFound();
  if (object.size > SMALL_OBJECT_LIMIT_BYTES) {
    // Asked for whole and too large to be the pointer or the manifest: the body is released unread.
    await object.body.cancel();
    return refuse(413, "too-large");
  }
  return new Response(object.body, {
    status: 200,
    headers: {
      "content-length": String(object.size),
      "content-type": "application/octet-stream",
    },
  });
}

async function putSmallObject(
  request: Request,
  bucket: AddressObjectBucket,
  key: string,
): Promise<Response> {
  const declared = declaredLength(request);
  if (declared === "malformed") return refuse(400, "length-malformed");
  if (declared !== null && declared > SMALL_OBJECT_LIMIT_BYTES) return refuse(413, "too-large");
  // Read with a ceiling rather than trusting the header: a body is small because its bytes are, not
  // because it said so.
  const bytes = await readBounded(request.body, SMALL_OBJECT_LIMIT_BYTES);
  if (bytes === null) return refuse(413, "too-large");
  await bucket.put(key, bytes);
  return new Response(null, { status: 204 });
}

async function serveUploads(
  request: Request,
  url: URL,
  options: ObjectHostOptions,
): Promise<Response> {
  const { bucket } = options;
  const path = url.pathname.slice(UPLOADS_PREFIX.length);
  const uploadIdentifier = url.searchParams.get("uploadId");

  // POST without an upload identifier starts one; POST with one, on a path ending in /complete,
  // finishes it. Telling the two apart by the identifier rather than by the path alone means a key
  // that happened to end in `/complete` could never be mistaken for a completion.
  if (request.method === "POST" && uploadIdentifier === null) {
    const key = addressObjectKeyOf(path);
    if (key === null) return refuse(400, "bad-key");
    const upload = await bucket.createMultipartUpload(key);
    return Response.json({ uploadId: upload.uploadId });
  }

  if (uploadIdentifier === null || !isUploadIdentifier(uploadIdentifier)) {
    return refuse(400, "bad-upload");
  }

  if (request.method === "POST" && path.endsWith(COMPLETE_SUFFIX)) {
    const key = addressObjectKeyOf(path.slice(0, -COMPLETE_SUFFIX.length));
    if (key === null) return refuse(400, "bad-key");
    return completeUpload(request, bucket, key, uploadIdentifier);
  }

  if (request.method === "PUT") {
    const key = addressObjectKeyOf(path);
    if (key === null) return refuse(400, "bad-key");
    return uploadPart(request, url, options, key, uploadIdentifier);
  }

  return notFound();
}

// An R2 upload identifier is an opaque token R2 minted; it is checked only for being a plausible one,
// so a header-sized string or a control character never reaches the binding.
function isUploadIdentifier(candidate: string): boolean {
  return candidate.length > 0 && candidate.length <= 1024 && /^[\x21-\x7e]+$/.test(candidate);
}

function partNumberOf(candidate: unknown): number | null {
  const number =
    typeof candidate === "string" && /^\d{1,5}$/.test(candidate) ? Number(candidate) : candidate;
  if (typeof number !== "number" || !Number.isInteger(number)) return null;
  if (number < LOWEST_PART_NUMBER || number > HIGHEST_PART_NUMBER) return null;
  return number;
}

async function uploadPart(
  request: Request,
  url: URL,
  options: ObjectHostOptions,
  key: string,
  uploadIdentifier: string,
): Promise<Response> {
  const partNumber = partNumberOf(url.searchParams.get("part"));
  if (partNumber === null) return refuse(400, "bad-part");
  // A part streams straight into R2, which needs its length before the first byte; the length is the
  // one the engine declared, and the stream wrapper holds the body to it.
  const declared = declaredLength(request);
  if (declared === "malformed") return refuse(400, "length-malformed");
  if (declared === null) return refuse(411, "length-required");
  if (declared > MULTIPART_PART_SIZE_BYTES) return refuse(413, "too-large");

  const body =
    request.body === null || declared === 0
      ? new Uint8Array(0)
      : options.knownLength(request.body, declared);
  const upload = options.bucket.resumeMultipartUpload(key, uploadIdentifier);
  const uploaded = await upload.uploadPart(partNumber, body);
  return Response.json({ etag: uploaded.etag });
}

async function completeUpload(
  request: Request,
  bucket: AddressObjectBucket,
  key: string,
  uploadIdentifier: string,
): Promise<Response> {
  const bytes = await readBounded(request.body, SMALL_OBJECT_LIMIT_BYTES);
  if (bytes === null) return refuse(413, "too-large");
  const parts = uploadedPartsOf(new TextDecoder().decode(bytes));
  if (parts === null) return refuse(400, "bad-parts");
  await bucket.resumeMultipartUpload(key, uploadIdentifier).complete(parts);
  return new Response(null, { status: 204 });
}

// `{ "parts": [{ "part": N, "etag": "…" }] }`, in the engine's vocabulary, to R2's. Every part number is
// in range and named once, every etag is a plausible one, and the list is put in part order — R2 wants
// the parts ascending, and the engine is not asked to promise it.
export function uploadedPartsOf(text: string): R2UploadedPart[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const list = (parsed as { parts?: unknown }).parts;
  if (!Array.isArray(list) || list.length === 0 || list.length > HIGHEST_PART_NUMBER) return null;
  const parts: R2UploadedPart[] = [];
  const seen = new Set<number>();
  for (const entry of list as unknown[]) {
    if (typeof entry !== "object" || entry === null) return null;
    const { part, etag } = entry as { part?: unknown; etag?: unknown };
    const partNumber = typeof part === "number" ? partNumberOf(part) : null;
    if (partNumber === null || seen.has(partNumber)) return null;
    if (typeof etag !== "string" || etag === "" || etag.length > 256) return null;
    seen.add(partNumber);
    parts.push({ partNumber, etag });
  }
  return parts.toSorted((left, right) => left.partNumber - right.partNumber);
}

// The declared content-length: a number, absent, or present and not one.
function declaredLength(request: Request): number | null | "malformed" {
  const header = request.headers.get("content-length");
  if (header === null) return null;
  if (!/^\d{1,16}$/.test(header.trim())) return "malformed";
  const length = Number(header.trim());
  return Number.isSafeInteger(length) ? length : "malformed";
}

// Read a body into memory only up to a ceiling; past it the stream is cancelled and the answer is
// null. Used for the two small shapes alone — a part never passes through here.
async function readBounded(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array | null> {
  if (body === null) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    // Sequential by nature: a stream yields its next chunk only after the previous one is taken.
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
