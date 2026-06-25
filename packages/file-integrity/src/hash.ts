import {
  ALGORITHM_RESULT_KEY,
  HASH_ALGORITHMS,
  type CreateDigestSink,
  type HashResult,
} from "./types.ts";

// Read the byte stream exactly once and fan every chunk into one sink per algorithm. The cost is a
// single pass over the bytes regardless of how many algorithms are requested; nothing is buffered
// beyond the current chunk. The five digests finalise together.
export async function hashAll(
  stream: ReadableStream<Uint8Array>,
  createSink: CreateDigestSink,
): Promise<HashResult> {
  const sinks = HASH_ALGORITHMS.map((algorithm) => ({ algorithm, sink: createSink(algorithm) }));
  const reader = stream.getReader();
  let sizeBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sizeBytes += value.byteLength;
      await Promise.all(sinks.map(({ sink }) => sink.write(value)));
    }
  } finally {
    reader.releaseLock();
  }
  const digests = await Promise.all(
    sinks.map(
      async ({ algorithm, sink }) =>
        [ALGORITHM_RESULT_KEY[algorithm], await sink.close()] as const,
    ),
  );
  const byKey = Object.fromEntries(digests) as Record<string, string>;
  return {
    md5: byKey.md5,
    sha1: byKey.sha1,
    sha256: byKey.sha256,
    sha384: byKey.sha384,
    sha512: byKey.sha512,
    sizeBytes,
  };
}
