import { describe, expect, it } from "vitest";
import { zipEntriesFromR2, type ZipSourceBucket } from "../src/zip-entries-from-r2.ts";

function bodyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>();
}

// A stub R2 read seam: maps a key to a body stream, or null for a reaped object. Records the keys it
// was asked for, in order, so we can assert the fetch sequence.
function stubBucket(objects: Record<string, ReadableStream<Uint8Array> | null>): {
  bucket: ZipSourceBucket;
  calls: string[];
} {
  const calls: string[] = [];
  const bucket: ZipSourceBucket = {
    get(key) {
      calls.push(key);
      const body = objects[key] ?? null;
      return Promise.resolve(body === null ? null : { body });
    },
  };
  return { bucket, calls };
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

describe("zipEntriesFromR2", () => {
  it("maps each present entry to { name: path, input: object body }", async () => {
    const a = bodyStream();
    const b = bodyStream();
    const { bucket } = stubBucket({ "k/a": a, "k/b": b });
    const out = await collect(
      zipEntriesFromR2(bucket, [
        { r2Key: "k/a", path: "folder/a.txt" },
        { r2Key: "k/b", path: "folder/b.txt" },
      ]),
    );
    expect(out).toEqual([
      { name: "folder/a.txt", input: a },
      { name: "folder/b.txt", input: b },
    ]);
  });

  it("skips a reaped object (get returns null) without aborting the rest of the archive", async () => {
    const a = bodyStream();
    const c = bodyStream();
    const { bucket } = stubBucket({ "k/a": a, "k/b": null, "k/c": c });
    const out = await collect(
      zipEntriesFromR2(bucket, [
        { r2Key: "k/a", path: "a" },
        { r2Key: "k/b", path: "b" },
        { r2Key: "k/c", path: "c" },
      ]),
    );
    expect(out).toEqual([
      { name: "a", input: a },
      { name: "c", input: c },
    ]);
  });

  it("fetches by r2Key, in entry order", async () => {
    const { bucket, calls } = stubBucket({ "k/a": bodyStream(), "k/b": bodyStream() });
    await collect(
      zipEntriesFromR2(bucket, [
        { r2Key: "k/a", path: "a" },
        { r2Key: "k/b", path: "b" },
      ]),
    );
    expect(calls).toEqual(["k/a", "k/b"]);
  });
});
