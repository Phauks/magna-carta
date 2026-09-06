import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256OfFile, sha256OfStream } from "$lib/file-manager/upload-hash.ts";

/*
 * The digest the browser takes before an upload must be the one the server would take over the
 * same bytes, whatever chunks the file arrived in; that equality is what makes the "already held"
 * answer honest. Pinned here against node's own SHA-256, with the read streamed, reported, and
 * stoppable.
 */

function chunked(bytes: Uint8Array, chunkSize: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

function bytesOf(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) bytes[index] = (index * 31 + 7) % 251;
  return bytes;
}

describe("sha256OfStream", () => {
  it("matches the whole-buffer digest whatever the chunking, and reports the bytes as it reads", async () => {
    const bytes = bytesOf(1_000_003);
    const expected = createHash("sha256").update(bytes).digest("hex");
    const seen: number[] = [];
    const digest = await sha256OfStream(chunked(bytes, 65_536), {
      onProgress: (readBytes) => {
        seen.push(readBytes);
      },
    });
    expect(digest).toBe(expected);
    expect(seen.at(-1)).toBe(bytes.byteLength);
    expect(seen.length).toBeGreaterThan(10);
    expect(await sha256OfStream(chunked(bytes, 7))).toBe(expected);
  });

  it("answers null once the signal aborts, without reading to the end", async () => {
    const bytes = bytesOf(200_000);
    const controller = new AbortController();
    let readBytes = 0;
    const digest = await sha256OfStream(chunked(bytes, 10_000), {
      signal: controller.signal,
      onProgress: (read) => {
        readBytes = read;
        if (read >= 30_000) controller.abort();
      },
    });
    expect(digest).toBeNull();
    expect(readBytes).toBeLessThan(bytes.byteLength);
  });
});

describe("sha256OfFile", () => {
  it("reads a File in place where there is no worker, and reads it the same as node does", async () => {
    const bytes = bytesOf(300_000);
    const file = new File([bytes], "brief.pdf", { type: "application/pdf" });
    expect(await sha256OfFile(file)).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("does not read a file whose signal is already aborted", async () => {
    const file = new File([bytesOf(10)], "brief.pdf");
    expect(await sha256OfFile(file, { signal: AbortSignal.abort() })).toBeNull();
  });
});
