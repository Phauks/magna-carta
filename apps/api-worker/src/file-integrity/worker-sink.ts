import type { DigestSink, HashAlgorithm } from "@magna-carta/file-integrity/types";

// crypto.DigestStream is a Workers runtime extension absent from @types/node's Crypto. Reach it
// through a precisely-typed accessor; the real implementation is workerd's, exercised in the Workers
// test pool, where streaming a multi-GB object never buffers.
interface DigestStreamConstructor {
  new (algorithm: string): WritableStream<Uint8Array> & { readonly digest: Promise<ArrayBuffer> };
}
const DigestStream = (crypto as unknown as { DigestStream: DigestStreamConstructor }).DigestStream;

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

// A DigestSink backed by the native streaming digest. The algorithm names this tool uses
// (MD5, SHA-1, SHA-256, SHA-384, SHA-512) are exactly those crypto.DigestStream accepts.
export function createWorkerDigestSink(algorithm: HashAlgorithm): DigestSink {
  const stream = new DigestStream(algorithm);
  const writer = stream.getWriter();
  return {
    write: (chunk) => writer.write(chunk),
    close: async () => {
      await writer.close();
      return toHex(await stream.digest);
    },
    abort: (reason) => writer.abort(reason),
  };
}
