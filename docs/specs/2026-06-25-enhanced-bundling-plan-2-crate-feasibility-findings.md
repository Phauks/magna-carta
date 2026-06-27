# Enhanced Bundling — Plan 2 crate feasibility findings

_Gate for Plan 2 (the `containers/bundle` Rust encoder). Verifies the Rust crates against the design's
requirements (golden rule 11). Dated 2026-06-25._

## Candidate crates

| Need | Crate | Verdict |
| --- | --- | --- |
| ZIP: Deflate + ZIP64 + AES-256 + UTF-8 + timestamps | **`zip` 8.6** (zip-rs/zip2) | ✅ Available. `FileOptions::with_aes_encryption` (AE-1/AE-2), ZIP64 force flag, Deflate levels, `time` feature for timestamps. **Already pinned by `containers/scan`** (its `Cargo.toml`), so the workspace knows it. |
| 7z: LZMA2 + AES-256 + header (filename) encryption | **`sevenz-rust2` 0.7.x** (hasenbanck fork; original `sevenz-rust` unmaintained) | ✅ Available. `ArchiveWriter` + `AesEncoderOptions` (AES-256) + `Lzma2Options`; `set_encrypt_header(true)` is the default → filenames/metadata encrypted. Pure Rust. |

Both are pure-Rust (no new C dependency — clean under golden rule 14). `zip` is already in the
dependency graph via the scan container.

## Finding A — both writers require `Write + Seek` (output spools to disk, not pure in-memory stream)

`zip::ZipWriter<W: Write + Seek>` and `sevenz_rust2::ArchiveWriter<W: Write + Seek>` both need a
**seekable** sink (each writes/patches headers after the body). A Worker/R2 write-only sink is therefore
not a valid direct target. **Resolution (no design change, only a wording refinement):** the container
streams each input body **from R2** (no full-input buffer), encodes into a **temporary file on the
container's ephemeral local disk** (the seekable sink), then streams that file **to R2** as a multipart
upload. The whole archive never lives in memory; it transits ephemeral disk — exactly as `containers/scan`
already buffers multi-GB files. The design's "streams R2→encoder→R2, never buffering the whole archive"
is refined to "never buffers the whole archive **in memory**; the output spools to ephemeral container
disk because the formats need random access." Instance disk is sized to the max bundle; disk is billed at
~$0.00000007/GB-s and scales to zero.

## Finding B — multi-volume splitting: clean for 7z, NOT natively feasible for ZIP

- **7z volumes (`.7z.001`, `.7z.002`, …) are a pure byte-split of the single `.7z` stream** —
  concatenating the parts reconstructs the archive; the 7z format itself is not volume-aware. So 7z
  splitting is implemented trivially at the upload layer: cut the spooled output into N-byte parts, each a
  separate R2 object. Recipients point 7-Zip at `.001` and it reassembles. ✅ format-native.
- **ZIP split archives (`.z01`/`.z02`/…`.zip`) are PKWARE "disk spanning"** — a different, proprietary
  format where the central directory carries per-disk numbers; it is NOT a naive byte-split, and **no
  surveyed Rust crate (`zip`/zip2 included) writes spanned/split ZIPs.** Building it ourselves is
  substantial and fiddly for low payoff.

**Implication:** format-native multi-volume splitting works for 7z but not for ZIP with available crates.
The capability registry (`bundle-formats.ts`) currently sets `zip.supportsSplit = true`; this finding
says that is not achievable natively. The resolution is an **open decision (below)** that determines the
registry value and the Plan 2 scope.

**Verification (double-checked 2026-06-25).** The `zip` crate's own docs list **"Multi-disk" under
"Currently unsupported zip extensions"** — explicit, for both read and write. The other ZIP crates that
surface are not relevant: `multizip` is iterator zipping (`zip2()`/`zip3()`…), `zip-extensions` is
high-level extract/create-from-folder helpers — neither writes spanned archives. No surveyed Rust crate
writes PKWARE disk-spanned ZIPs. Separately confirmed that 7-Zip recombines `.7z.001/.002` by plain
concatenation (point at `.001`, or `copy /b`/`cat` the parts) — i.e. the volumes are one `.7z` stream cut
into byte-size pieces (start header in `.001`, end header in the last part), so producing them at the
upload layer is correct. Conclusion stands: native split is 7z-only.

## Streaming inputs

Reading each entry's bytes from R2 and feeding the encoder incrementally is supported by both crates
(write side consumes a `Read`/byte source per entry). The per-entry content SHA-256 for the `CONTENTS`
manifest comes from the existing `file_version` hash (D1 metadata) — the container does not re-hash.

## Open decision (blocks Plan 2 scope + the `zip.supportsSplit` capability value)

Splitting cannot be format-native for ZIP. Options:
1. **Split offered only for 7z** (recommended) — set `zip.supportsSplit = false`; the UI hides "split"
   when ZIP is chosen. 7z is the better split format anyway (it is what 7-Zip itself produces). Honest,
   uses the capability registry as designed, smallest scope.
2. **ZIP byte-split with rejoin** — produce `.zip.001/.002` parts the recipient must concatenate
   (`copy /b` / `cat`) before extracting. This is the "raw byte-split" UX previously rejected, but it
   keeps "split" available for ZIP.
3. **Implement ZIP disk-spanning ourselves** — full `.z01` support. Large effort, error-prone, low payoff.

## Decision (resolved 2026-06-25): split is 7z-only

Option 1 chosen — **splitting is offered only for 7z.** `bundle-formats.ts` is corrected to
`zip.supportsSplit = false` (the existing `validateOptionsForFormat` then rejects a ZIP + split request,
and the UI hides the split control when ZIP is selected). ZIP always produces a single artifact. This
keeps the scope honest, uses the capability registry as designed, and gives split the proper native
format (7z is what 7-Zip itself produces). Recorded in the ADR
(`docs/decisions/pending/enhanced-bundling-formats-encryption-split.md`).

## Container ↔ R2 data flow (resolved by "outbound Workers")

How does `containers/bundle` read inputs and write output volumes? Three models were weighed:

1. **Container ↔ R2 directly (S3 API / presigned URLs).** Container holds scoped R2 credentials (or
   per-object presigned URLs) and needs egress to the R2 endpoint. Keeps bytes off the Worker but adds a
   credential + egress surface to a new container.
2. **Worker proxies bytes (the `containers/scan` model).** Worker POSTs inputs to the container and
   receives the archive. Container stays credential/egress-free, but the Worker custom-proxies many
   inputs + a large output.
3. **Outbound Workers (RECOMMENDED).** Since 2026-03-26 (`@cloudflare/containers` ≥ 0.2.0), a container
   reaches Worker bindings over HTTP: it requests `http://<host>/<key>` and an `outboundByHost` handler
   **in the owner Worker** services it via `env.R2` (`get`→stream `object.body` on a GET, `put(key, body)`
   on a PUT). The handler runs in the Workers runtime, outside the container sandbox. Docs:
   [outbound traffic](https://developers.cloudflare.com/containers/platform-details/outbound-traffic/),
   [changelog](https://developers.cloudflare.com/changelog/post/2026-03-26-outbound-workers/).

**Decision: model 3.** The container holds **no R2 credentials and needs no general egress** — as hardened
as `containers/scan` (`enableInternet=false`, loopback-only). Every R2 read/write is **mediated by the
owner Worker's existing `env.R2` binding** (it authorizes each key against the firm/job), and bytes stream
through the platform's outbound mechanism rather than custom hot-path proxy code. The container spools the
encoded archive to ephemeral disk (Finding A) so it knows each volume's exact size and issues sized PUTs.
The HTTP contract the Worker sends the container is therefore a **manifest only** — `{ inputs:
[{ r2Key, archivePath }], options, password? (in-memory), outputKeyPrefix }` — never bytes. Requires the
worker's `@cloudflare/containers` Container class at ≥ 0.2.0 (verify the pinned version when building).

## Conclusion

Crates are sufficient for ZIP (Deflate/ZIP64/AES, single-artifact) and 7z (LZMA2/AES-256/header-encryption
+ byte-split volumes) with a disk-spool output model, and the container reaches R2 through the owner
Worker's `env.R2` binding via outbound Workers — credential-free and egress-free. Plan 2 is feasible.
