# @magna-carta/file-integrity — local notes

Pure core for the File Hash & Integrity tool. No D1, no Hono, no `env`, no Svelte, no network — all
effects injected.

- `hashAll(stream, createSink)` reads a byte stream once and fans every chunk into one `DigestSink`
  per algorithm (`MD5`, `SHA-1`, `SHA-256`, `SHA-384`, `SHA-512`). One pass, five digests; nothing
  buffered beyond the current chunk.
- `DigestSink` is the injected seam. The Worker backs it with `crypto.DigestStream`
  (`apps/api-worker/src/file-integrity/worker-sink.ts`); tests back it with `node:crypto`
  (`test/node-sink.ts`). The package itself never imports either runtime.
- `compareToBaseline(computedSha256, baselineSha256)` → `match` | `mismatch` | `no-baseline`. Only
  SHA-256 has an ingest baseline (`file_version.content_sha256`).
- `buildReceipt` / `renderReceiptText` produce the structured + text hash receipt. A signed or PDF
  receipt slots in behind `buildReceipt` later.
