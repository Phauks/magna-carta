import { AwsClient } from "aws4fetch";
import type { DataRegion } from "@magna-carta/database/data-region";
import { r2S3Endpoint } from "./r2-s3-endpoint.ts";

// An `R2Bucket`-shaped handle backed by SigV4-signed calls to R2's S3-compatible endpoint, for a
// bucket this Worker has no binding to.
//
// WHY THIS EXISTS. A firm's objects live in that firm's own bucket, and R2 bindings are static
// Wrangler configuration — there is no runtime API that turns a bucket name into an `R2Bucket`. So a
// firm provisioned after the last deploy has a bucket the Worker cannot address at all. This closes
// that gap without putting firm creation on the release path: the resolver in firm-bucket.ts hands
// back this object instead of a binding when the firm's bucket is not the bound one, and its ~35
// call sites do not change.
//
// The transport is not new. presign.ts already signs server-side S3 calls to arbitrary bucket names
// with the same account-scoped credential, which reaches every bucket in the account. What is new is
// the object plane, and it is written to the surface the callers actually use rather than to the whole
// of `R2Bucket` — see UNSUPPORTED below, which throws rather than pretending.
//
// THE ONE RULE FOR CHANGES HERE: a difference between this and the binding must be loud. Every place
// the S3 API cannot answer what the binding would have answered either does the extra work (list with
// `include` HEADs each object) or throws. A field silently left undefined is how a sweep comes to
// believe every object is unstamped and rewrites a firm's whole bucket.

/**
 * What signs this bucket's calls, resolved per operation rather than fixed at construction.
 *
 * A resolver rather than a key pair because the credential is not always a constant: the deployed
 * path mints one scoped to THIS bucket with a lifetime (firm-bucket-credentials.ts), so the key
 * actually on the object plane reaches one firm for one window instead of every bucket in the
 * account forever. Resolving per operation is what lets it be re-minted when it ages out without
 * anything reconstructing this object — and it costs nothing, because every call here was already
 * awaiting the signature.
 */
export type S3Credentials = {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Present on a minted credential; sent as X-Amz-Security-Token. Absent on a parent key. */
  readonly sessionToken?: string;
};

export interface S3FirmBucketOptions {
  readonly bucketName: string;
  readonly accountId: string;
  readonly credentials: () => Promise<S3Credentials>;
  readonly region: DataRegion;
  // Injectable for tests; defaults to the runtime fetch. The Miniflare pool has no S3 endpoint, so
  // every test of this module drives it through a stub.
  readonly fetchImpl?: (request: Request) => Promise<Response>;
}

// R2's multipart minimum: every part but the last must be at least 5 MiB. A stream of unknown length
// cannot be signed as a single PUT (SigV4 needs the payload hash, and S3 needs a content length), so a
// streamed body is uploaded as uniform parts of this size — the same shape the bundle build already
// uses against the binding.
const STREAM_PART_SIZE = 5 * 1024 * 1024;

// Keys are opaque and already URL-safe, but each segment is percent-encoded so a key can never break
// out of its path. Matches presign.ts, deliberately: the two address the same objects.
function encodeKey(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function unsupported(member: string): never {
  throw new Error(
    `${member} is not implemented by the S3-backed firm bucket — no caller uses it, and a silent ` +
      "no-op here would be a difference from the R2 binding that nothing would notice",
  );
}

function customMetadataFrom(headers: Headers): Record<string, string> {
  const metadata: Record<string, string> = {};
  headers.forEach((value, name) => {
    if (name.toLowerCase().startsWith("x-amz-meta-")) {
      metadata[name.slice("x-amz-meta-".length)] = value;
    }
  });
  return metadata;
}

function httpMetadataFrom(headers: Headers): R2HTTPMetadata {
  const expires = headers.get("expires");
  const parsedExpires = expires === null ? undefined : new Date(expires);
  return {
    ...(headers.get("content-type") !== null && { contentType: headers.get("content-type")! }),
    ...(headers.get("content-language") !== null && {
      contentLanguage: headers.get("content-language")!,
    }),
    ...(headers.get("content-disposition") !== null && {
      contentDisposition: headers.get("content-disposition")!,
    }),
    ...(headers.get("content-encoding") !== null && {
      contentEncoding: headers.get("content-encoding")!,
    }),
    ...(headers.get("cache-control") !== null && { cacheControl: headers.get("cache-control")! }),
    ...(parsedExpires !== undefined &&
      !Number.isNaN(parsedExpires.getTime()) && { cacheExpiry: parsedExpires }),
  };
}

function httpMetadataToHeaders(metadata: R2HTTPMetadata | Headers | undefined): Headers {
  const headers = new Headers();
  if (metadata === undefined) return headers;
  if (metadata instanceof Headers) return new Headers(metadata);
  if (metadata.contentType !== undefined) headers.set("content-type", metadata.contentType);
  if (metadata.contentLanguage !== undefined) {
    headers.set("content-language", metadata.contentLanguage);
  }
  if (metadata.contentDisposition !== undefined) {
    headers.set("content-disposition", metadata.contentDisposition);
  }
  if (metadata.contentEncoding !== undefined) {
    headers.set("content-encoding", metadata.contentEncoding);
  }
  if (metadata.cacheControl !== undefined) headers.set("cache-control", metadata.cacheControl);
  if (metadata.cacheExpiry !== undefined)
    headers.set("expires", metadata.cacheExpiry.toUTCString());
  return headers;
}

// R2 storage classes travel as the S3 header value: "Standard" / "InfrequentAccess". The binding
// accepts the same two spellings, so they pass through unchanged.
function storageClassOf(headers: Headers): string {
  return headers.get("x-amz-storage-class") ?? "Standard";
}

// The checksum set the binding computes. S3 reports an ETag, which for a single-part upload IS the
// MD5 — but not for a multipart one, where it is a digest of digests. Reporting a multipart ETag as an
// MD5 would be a wrong answer rather than a missing one, so nothing is claimed here; no caller reads
// checksums today, and one that starts to will get an empty set rather than a fabricated digest.
function emptyChecksums(): R2Checksums {
  return { toJSON: () => ({}) } as unknown as R2Checksums;
}

interface ParsedObjectHead {
  readonly size: number;
  readonly etag: string;
  readonly httpEtag: string;
  readonly uploaded: Date;
  readonly version: string;
  readonly httpMetadata: R2HTTPMetadata;
  readonly customMetadata: Record<string, string>;
  readonly storageClass: string;
}

// `content-length` on a ranged GET describes the RANGE, not the object; `content-range` carries the
// object's true size as the value after the slash. Reading the length off a ranged response is how an
// object comes to report itself as the size of the slice somebody happened to ask for.
function parseHead(headers: Headers): ParsedObjectHead {
  const contentRange = headers.get("content-range");
  const totalFromRange =
    contentRange === null ? null : Number(/\/(\d+)\s*$/.exec(contentRange)?.[1] ?? Number.NaN);
  const size =
    totalFromRange !== null && Number.isFinite(totalFromRange)
      ? totalFromRange
      : Number(headers.get("content-length") ?? "0");
  const httpEtag = headers.get("etag") ?? '""';
  const lastModified = headers.get("last-modified");
  const uploaded = lastModified === null ? new Date(0) : new Date(lastModified);
  return {
    size,
    etag: httpEtag.replaceAll('"', ""),
    httpEtag,
    uploaded: Number.isNaN(uploaded.getTime()) ? new Date(0) : uploaded,
    // R2 buckets are not versioned here, so the object's identity for a caller comparing "is this the
    // same bytes" is its ETag. source.version is read exactly that way.
    version: headers.get("x-amz-version-id") ?? httpEtag.replaceAll('"', ""),
    httpMetadata: httpMetadataFrom(headers),
    customMetadata: customMetadataFrom(headers),
    storageClass: storageClassOf(headers),
  };
}

function makeR2Object(key: string, head: ParsedObjectHead, range?: R2Range): R2Object {
  return {
    key,
    version: head.version,
    size: head.size,
    etag: head.etag,
    httpEtag: head.httpEtag,
    checksums: emptyChecksums(),
    uploaded: head.uploaded,
    httpMetadata: head.httpMetadata,
    customMetadata: head.customMetadata,
    range,
    storageClass: head.storageClass,
    writeHttpMetadata(headers: Headers): void {
      httpMetadataToHeaders(head.httpMetadata).forEach((value, name) => headers.set(name, value));
    },
  } as R2Object;
}

function makeR2ObjectBody(
  key: string,
  head: ParsedObjectHead,
  response: Response,
  range?: R2Range,
): R2ObjectBody {
  const base = makeR2Object(key, head, range);
  return Object.assign(Object.create(Object.getPrototypeOf(base) as object) as object, base, {
    body: response.body ?? new ReadableStream<Uint8Array>(),
    get bodyUsed(): boolean {
      return response.bodyUsed;
    },
    arrayBuffer: () => response.arrayBuffer(),
    text: () => response.text(),
    json: <T>() => response.json() as Promise<T>,
    blob: () => response.blob(),
    bytes: async () => new Uint8Array(await response.arrayBuffer()),
  }) as R2ObjectBody;
}

// The binding takes `{ offset, length }`, `{ offset }`, `{ length }`, or `{ suffix }`; S3 takes one
// Range header. A suffix range is the "last N bytes" form.
function rangeHeaderFor(range: R2Range): string {
  if ("suffix" in range) return `bytes=-${range.suffix}`;
  const offset = "offset" in range && range.offset !== undefined ? range.offset : 0;
  if ("length" in range && range.length !== undefined) {
    return `bytes=${offset}-${offset + range.length - 1}`;
  }
  return `bytes=${offset}-`;
}

// One XML element's text, non-greedy, from a ListObjectsV2 body. The response is machine-generated by
// R2 and has no namespaces or attributes on these elements; there is no XML parser in the runtime, and
// presign.ts reads UploadId the same way.
function xmlValues(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((match) =>
    decodeXmlText(match[1] ?? ""),
  );
}

function decodeXmlText(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function createS3FirmBucket(options: S3FirmBucketOptions): R2Bucket {
  const endpoint = r2S3Endpoint(options.accountId, options.region);
  const doFetch = options.fetchImpl ?? ((request: Request) => fetch(request));
  const objectUrl = (key: string) => `${endpoint}/${options.bucketName}/${encodeKey(key)}`;

  /**
   * The signer for one call. Built per operation because the credential behind it can be re-minted
   * between calls; the resolver does its own caching, so this is a map lookup in the ordinary case.
   * region "auto" is R2's S3 SIGNING region — distinct from the firm's data region, which selected
   * the endpoint host above; service "s3" selects the S3 canonicalization.
   */
  async function signer(): Promise<AwsClient> {
    const credentials = await options.credentials();
    return new AwsClient({
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      ...(credentials.sessionToken === undefined ? {} : { sessionToken: credentials.sessionToken }),
      service: "s3",
      region: "auto",
    });
  }

  async function send(
    url: string,
    init: { method: string; headers?: HeadersInit; body?: BodyInit | null },
  ): Promise<Response> {
    const client = await signer();
    return doFetch(await client.sign(url, init));
  }

  function failed(operation: string, key: string, response: Response): Error {
    return new Error(
      `R2 S3 ${operation} failed for ${options.bucketName}/${key}: ${response.status}`,
    );
  }

  async function headObject(key: string): Promise<ParsedObjectHead | null> {
    const response = await send(objectUrl(key), { method: "HEAD" });
    if (response.status === 404) return null;
    if (!response.ok) throw failed("head", key, response);
    return parseHead(response.headers);
  }

  // A part-by-part multipart upload, used for a streamed body and by createMultipartUpload's callers.
  async function beginMultipart(key: string, headers: Headers): Promise<string> {
    const response = await send(`${objectUrl(key)}?uploads`, { method: "POST", headers });
    if (!response.ok) throw failed("create multipart upload", key, response);
    const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(await response.text())?.[1];
    if (uploadId === undefined) {
      throw new Error(`R2 S3 create multipart upload for ${key} carried no UploadId`);
    }
    return uploadId;
  }

  async function uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    bytes: Uint8Array,
  ): Promise<R2UploadedPart> {
    const url = `${objectUrl(key)}?partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`;
    const response = await send(url, { method: "PUT", body: bytes as unknown as BodyInit });
    if (!response.ok) throw failed(`upload part ${partNumber}`, key, response);
    const etag = response.headers.get("etag");
    if (etag === null)
      throw new Error(`R2 S3 upload part ${partNumber} for ${key} returned no ETag`);
    return { partNumber, etag };
  }

  async function completeMultipart(
    key: string,
    uploadId: string,
    parts: readonly R2UploadedPart[],
  ): Promise<void> {
    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const body =
      "<CompleteMultipartUpload>" +
      ordered
        .map(
          (part) =>
            `<Part><PartNumber>${part.partNumber}</PartNumber>` +
            `<ETag>${escapeXmlText(part.etag)}</ETag></Part>`,
        )
        .join("") +
      "</CompleteMultipartUpload>";
    const response = await send(`${objectUrl(key)}?uploadId=${encodeURIComponent(uploadId)}`, {
      method: "POST",
      body,
      headers: { "content-type": "application/xml" },
    });
    if (!response.ok) throw failed("complete multipart upload", key, response);
    // S3 can report a failure INSIDE a 200 on this call — the connection is held open while the parts
    // are assembled, so the status is written before the outcome is known. A body carrying <Error> is
    // a failed upload no matter what the status line said.
    if ((await response.text()).includes("<Error>")) {
      throw new Error(`R2 S3 complete multipart upload for ${key} reported an error in its body`);
    }
  }

  async function abortMultipart(key: string, uploadId: string): Promise<void> {
    const response = await send(`${objectUrl(key)}?uploadId=${encodeURIComponent(uploadId)}`, {
      method: "DELETE",
    });
    // Already gone (a replayed abort, or lifecycle reaped it) is success: abort is idempotent.
    if (!response.ok && response.status !== 404)
      throw failed("abort multipart upload", key, response);
  }

  // A streamed body has no length to sign and no hash to compute up front, so it is cut into uniform
  // parts that do. Each part is a materialized buffer, which is what makes it signable at all.
  async function putStream(
    key: string,
    stream: ReadableStream<Uint8Array>,
    headers: Headers,
  ): Promise<void> {
    const uploadId = await beginMultipart(key, headers);
    try {
      const parts: R2UploadedPart[] = [];
      const reader = stream.getReader();
      let pending: Uint8Array[] = [];
      let pendingBytes = 0;
      const flush = async (bytes: Uint8Array) => {
        parts.push(await uploadPart(key, uploadId, parts.length + 1, bytes));
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.byteLength === 0) continue;
        pending.push(value);
        pendingBytes += value.byteLength;
        while (pendingBytes >= STREAM_PART_SIZE) {
          const merged = concat(pending, pendingBytes);
          await flush(merged.subarray(0, STREAM_PART_SIZE));
          const rest = merged.subarray(STREAM_PART_SIZE);
          pending = rest.byteLength > 0 ? [rest] : [];
          pendingBytes = rest.byteLength;
        }
      }
      if (pendingBytes > 0 || parts.length === 0) await flush(concat(pending, pendingBytes));
      await completeMultipart(key, uploadId, parts);
    } catch (error) {
      // Best-effort: a throwing abort must not replace the original error, which carries the cause.
      try {
        await abortMultipart(key, uploadId);
      } catch {
        // swallow — the original error is rethrown below
      }
      throw error;
    }
  }

  function concat(chunks: readonly Uint8Array[], totalBytes: number): Uint8Array {
    if (chunks.length === 1) return chunks[0]!;
    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged;
  }

  const bucket = {
    async head(key: string): Promise<R2Object | null> {
      const head = await headObject(key);
      return head === null ? null : makeR2Object(key, head);
    },

    async get(key: string, getOptions?: R2GetOptions): Promise<R2ObjectBody | null> {
      if (getOptions?.onlyIf !== undefined) unsupported("get with onlyIf");
      // The binding accepts either an R2Range or a Headers carrying a Range line; only the former is
      // reported back on the object, so a Headers range passes through to S3 and is not echoed.
      const requested = getOptions?.range;
      const range = requested instanceof Headers ? undefined : requested;
      const headers = new Headers();
      if (requested instanceof Headers) {
        const line = requested.get("range");
        if (line !== null) headers.set("range", line);
      } else if (range !== undefined) {
        headers.set("range", rangeHeaderFor(range));
      }
      const response = await send(objectUrl(key), { method: "GET", headers });
      if (response.status === 404) return null;
      // A range that starts past the end of the object: the binding returns null rather than throwing.
      if (response.status === 416) return null;
      if (!response.ok) throw failed("get", key, response);
      return makeR2ObjectBody(key, parseHead(response.headers), response, range);
    },

    async put(
      key: string,
      value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
      putOptions?: R2PutOptions,
    ): Promise<R2Object> {
      if (putOptions?.onlyIf !== undefined) unsupported("put with onlyIf");
      const headers = httpMetadataToHeaders(putOptions?.httpMetadata);
      for (const [name, metadataValue] of Object.entries(putOptions?.customMetadata ?? {})) {
        headers.set(`x-amz-meta-${name}`, metadataValue);
      }
      if (putOptions?.storageClass !== undefined) {
        headers.set("x-amz-storage-class", putOptions.storageClass);
      }

      if (value instanceof ReadableStream) {
        await putStream(key, value as ReadableStream<Uint8Array>, headers);
      } else {
        const response = await send(objectUrl(key), {
          method: "PUT",
          headers,
          body: (value ?? "") as BodyInit,
        });
        if (!response.ok) throw failed("put", key, response);
      }

      // The binding's put resolves to the stored object. S3's PUT returns only an ETag, and a
      // completed multipart returns no usable size at all, so the object is read back rather than
      // assembled from what the write happened to echo. Callers read .etag and .key off this.
      const head = await headObject(key);
      if (head === null) {
        throw new Error(`R2 S3 put of ${options.bucketName}/${key} stored nothing readable back`);
      }
      return makeR2Object(key, head);
    },

    async delete(keys: string | string[]): Promise<void> {
      if (typeof keys === "string") {
        const response = await send(objectUrl(keys), { method: "DELETE" });
        // S3 DELETE is idempotent and answers 204 for an absent key; 404 is treated the same way.
        if (!response.ok && response.status !== 404) throw failed("delete", keys, response);
        return;
      }
      if (keys.length === 0) return;
      // DeleteObjects caps at 1000 keys per request; the binding takes an unbounded array, so the
      // batching happens here rather than at every call site.
      for (let index = 0; index < keys.length; index += 1000) {
        const page = keys.slice(index, index + 1000);
        const body =
          "<Delete>" +
          page.map((key) => `<Object><Key>${escapeXmlText(key)}</Key></Object>`).join("") +
          "<Quiet>true</Quiet></Delete>";
        const response = await send(`${endpoint}/${options.bucketName}?delete`, {
          method: "POST",
          body,
          headers: { "content-type": "application/xml" },
        });
        if (!response.ok) throw failed("delete", `${page.length} keys`, response);
        // Quiet mode reports only failures, so any <Error> in the body is a key that survived.
        const text = await response.text();
        if (text.includes("<Error>")) {
          throw new Error(
            `R2 S3 delete left ${xmlValues(text, "Key").length} object(s) in ` +
              `${options.bucketName}: ${xmlValues(text, "Message").join("; ")}`,
          );
        }
      }
    },

    async list(listOptions?: R2ListOptions): Promise<R2Objects> {
      if (listOptions?.delimiter !== undefined) unsupported("list with a delimiter");
      if (listOptions?.startAfter !== undefined) unsupported("list with startAfter");
      const query = new URLSearchParams({ "list-type": "2" });
      if (listOptions?.prefix !== undefined) query.set("prefix", listOptions.prefix);
      if (listOptions?.limit !== undefined) query.set("max-keys", String(listOptions.limit));
      if (listOptions?.cursor !== undefined) query.set("continuation-token", listOptions.cursor);
      const response = await send(`${endpoint}/${options.bucketName}?${query.toString()}`, {
        method: "GET",
      });
      if (!response.ok) throw failed("list", listOptions?.prefix ?? "", response);
      const xml = await response.text();

      const contents = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(
        (match) => match[1] ?? "",
      );
      const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/.test(xml);
      const cursor = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1];

      // ListObjectsV2 does not return user metadata or response headers — only key, size, ETag,
      // LastModified and StorageClass. The binding's `include` populates them, and a sweep that reads
      // customMetadata off a listing decides whether an object is stamped by it. Returning undefined
      // would tell the dimension backfill that every object is unstamped and set it rewriting a firm's
      // whole bucket, so the fields are fetched with a HEAD each instead. This is deliberately the
      // expensive answer rather than the wrong one; `include` is only used by capped sweeps.
      const wantsMetadata = (listOptions?.include ?? []).length > 0;
      const objects = await Promise.all(
        contents.map(async (entry) => {
          const key = decodeXmlText(/<Key>([\s\S]*?)<\/Key>/.exec(entry)?.[1] ?? "");
          if (wantsMetadata) {
            const head = await headObject(key);
            if (head !== null) return makeR2Object(key, head);
          }
          const httpEtag = decodeXmlText(/<ETag>([\s\S]*?)<\/ETag>/.exec(entry)?.[1] ?? '""');
          const lastModified = /<LastModified>([\s\S]*?)<\/LastModified>/.exec(entry)?.[1] ?? "";
          const uploaded = new Date(lastModified);
          return makeR2Object(key, {
            size: Number(/<Size>([\s\S]*?)<\/Size>/.exec(entry)?.[1] ?? "0"),
            etag: httpEtag.replaceAll('"', ""),
            httpEtag,
            uploaded: Number.isNaN(uploaded.getTime()) ? new Date(0) : uploaded,
            version: httpEtag.replaceAll('"', ""),
            httpMetadata: {},
            customMetadata: {},
            storageClass: /<StorageClass>([\s\S]*?)<\/StorageClass>/.exec(entry)?.[1] ?? "Standard",
          });
        }),
      );

      return {
        objects,
        truncated,
        ...(truncated && cursor !== undefined && { cursor }),
        delimitedPrefixes: [],
      } as unknown as R2Objects;
    },

    async createMultipartUpload(
      key: string,
      createOptions?: R2MultipartOptions,
    ): Promise<R2MultipartUpload> {
      const headers = httpMetadataToHeaders(createOptions?.httpMetadata);
      for (const [name, value] of Object.entries(createOptions?.customMetadata ?? {})) {
        headers.set(`x-amz-meta-${name}`, value);
      }
      if (createOptions?.storageClass !== undefined) {
        headers.set("x-amz-storage-class", createOptions.storageClass);
      }
      const uploadId = await beginMultipart(key, headers);
      return bucket.resumeMultipartUpload(key, uploadId);
    },

    // The binding's R2MultipartUpload is a stateful handle; S3's equivalent is an upload id plus the
    // part ETags the caller accumulates. This wraps the id back into the handle shape so the three
    // multipart call sites do not change.
    resumeMultipartUpload(key: string, uploadId: string): R2MultipartUpload {
      return {
        key,
        uploadId,
        uploadPart: async (
          partNumber: number,
          part: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
        ) => {
          const bytes =
            part instanceof ReadableStream
              ? new Uint8Array(await new Response(part as ReadableStream).arrayBuffer())
              : part instanceof Blob
                ? new Uint8Array(await part.arrayBuffer())
                : typeof part === "string"
                  ? new TextEncoder().encode(part)
                  : part instanceof ArrayBuffer
                    ? new Uint8Array(part)
                    : new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
          return uploadPart(key, uploadId, partNumber, bytes);
        },
        complete: async (parts: R2UploadedPart[]) => {
          await completeMultipart(key, uploadId, parts);
          const head = await headObject(key);
          if (head === null) {
            throw new Error(
              `R2 S3 multipart completion of ${options.bucketName}/${key} stored nothing readable back`,
            );
          }
          return makeR2Object(key, head);
        },
        abort: () => abortMultipart(key, uploadId),
      } as unknown as R2MultipartUpload;
    },
  };

  return bucket as unknown as R2Bucket;
}
