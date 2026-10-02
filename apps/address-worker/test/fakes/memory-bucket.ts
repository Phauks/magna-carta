import type { AddressObjectBucket } from "../../src/object-host.ts";

// An in-memory stand-in for the subset of the R2 binding the object host uses. It keeps R2's rules
// that the host relies on rather than only its shapes: a range that starts past the end throws (as R2
// does), every part of a multipart upload but the last must be the same size, a part number is named
// once, and an unknown upload identifier is refused. Each call is recorded so a test can say how many
// storage operations a request cost.

interface StoredObject {
  readonly bytes: Uint8Array;
}

interface PendingUpload {
  readonly key: string;
  readonly parts: Map<number, { readonly etag: string; readonly bytes: Uint8Array }>;
}

export interface MemoryBucket {
  readonly bucket: AddressObjectBucket;
  readonly objects: Map<string, StoredObject>;
  readonly uploads: Map<string, PendingUpload>;
  readonly operations: string[];
  put(key: string, bytes: Uint8Array | string): void;
}

async function bytesOf(value: unknown): Promise<Uint8Array> {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value instanceof ReadableStream) {
    return new Uint8Array(await new Response(value).arrayBuffer());
  }
  throw new Error("memory bucket: unsupported body");
}

function bodyOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new Response(bytes).body as ReadableStream<Uint8Array>;
}

function objectFor(key: string, bytes: Uint8Array, slice: Uint8Array) {
  const body = bodyOf(slice);
  return {
    key,
    size: bytes.byteLength,
    body,
    text: () => new Response(body).text(),
  };
}

export function memoryBucket(): MemoryBucket {
  const objects = new Map<string, StoredObject>();
  const uploads = new Map<string, PendingUpload>();
  const operations: string[] = [];
  let nextUpload = 0;

  function upload(key: string, uploadId: string) {
    return {
      key,
      uploadId,
      async uploadPart(partNumber: number, value: unknown) {
        operations.push("uploadPart");
        const pending = uploads.get(uploadId);
        if (pending?.key !== key) throw new Error("NoSuchUpload");
        const bytes = await bytesOf(value);
        const etag = `etag-${String(partNumber)}-${String(bytes.byteLength)}`;
        pending.parts.set(partNumber, { etag, bytes });
        return { partNumber, etag };
      },
      async complete(parts: R2UploadedPart[]) {
        operations.push("complete");
        const pending = uploads.get(uploadId);
        if (pending?.key !== key) throw new Error("NoSuchUpload");
        const chosen = parts.map((part) => {
          const stored = pending.parts.get(part.partNumber);
          if (stored?.etag !== part.etag) throw new Error("InvalidPart");
          return stored.bytes;
        });
        const leading = chosen.slice(0, -1);
        if (leading.some((bytes) => bytes.byteLength !== leading[0]?.byteLength)) {
          throw new Error("every part but the last must be the same size");
        }
        const total = chosen.reduce((sum, bytes) => sum + bytes.byteLength, 0);
        const joined = new Uint8Array(total);
        let offset = 0;
        for (const bytes of chosen) {
          joined.set(bytes, offset);
          offset += bytes.byteLength;
        }
        objects.set(key, { bytes: joined });
        uploads.delete(uploadId);
        return { key, size: total };
      },
      abort() {
        uploads.delete(uploadId);
        return Promise.resolve();
      },
    };
  }

  const bucket = {
    head(key: string) {
      operations.push("head");
      const stored = objects.get(key);
      return Promise.resolve(stored === undefined ? null : { key, size: stored.bytes.byteLength });
    },
    get(key: string, options?: { range?: { offset: number; length: number } }) {
      operations.push("get");
      const stored = objects.get(key);
      if (stored === undefined) return Promise.resolve(null);
      const range = options?.range;
      if (range === undefined) {
        return Promise.resolve(objectFor(key, stored.bytes, stored.bytes));
      }
      if (range.offset >= stored.bytes.byteLength) {
        return Promise.reject(new Error("InvalidRange: the requested range is not satisfiable"));
      }
      const slice = stored.bytes.slice(range.offset, range.offset + range.length);
      return Promise.resolve(objectFor(key, stored.bytes, slice));
    },
    async put(key: string, value: unknown) {
      operations.push("put");
      const bytes = await bytesOf(value);
      objects.set(key, { bytes });
      return { key, size: bytes.byteLength };
    },
    delete(key: string) {
      operations.push("delete");
      objects.delete(key);
      return Promise.resolve();
    },
    createMultipartUpload(key: string) {
      operations.push("createMultipartUpload");
      nextUpload += 1;
      const uploadId = `upload-${String(nextUpload)}`;
      uploads.set(uploadId, { key, parts: new Map() });
      return Promise.resolve(upload(key, uploadId));
    },
    resumeMultipartUpload(key: string, uploadId: string) {
      return upload(key, uploadId);
    },
  };

  return {
    bucket: bucket as unknown as AddressObjectBucket,
    objects,
    uploads,
    operations,
    put(key, bytes) {
      objects.set(key, {
        bytes: typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes,
      });
    },
  };
}
