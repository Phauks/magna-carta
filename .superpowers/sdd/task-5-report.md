# Task 5 Report — PDF `extract_hash` + `verify_guess` (R2–R6)

**Status: DONE.** All gate vectors pass; clippy/fmt pristine. Commit `2a47cbf`.

## Starting state

The worktree already carried an **uncommitted** implementation (extract_hash, parse_hash,
verify_guess, hash_2b, verify_legacy, the legacy MD5/RC4 derivation, and the FormatAdapter
impl) plus `KdfParams::Pdf` in `adapter.rs`. Two things were wrong, and clippy/fmt were dirty:

1. The R6 example-hash test constant was a **fabricated placeholder** — a 127-byte U/O with
   long all-zero tails and all-zero UE/OE. That is not a valid PDF R6 structure (real R6 U/O
   are 48 bytes). It did not even parse (`Malformed("odd-length hex field")`), so both
   example-hash tests failed.
2. `parse_hash` required ≥15 `*`-fields for R5/R6, i.e. it demanded UE/OE — but a real
   hashcat `-m 10700` password hash omits UE/OE (11 fields).

## The real hashcat mode-10700 example hash used

```
$pdf$5*6*256*-4*1*16*381692e488413f5502fa7314a78c25db*48*e5bf81a2a23c88f3dccb44bc7da68bb5606b653b733bcf9adaa5eb2c8ccf53abba66539044eb1957eda68469b1d0b9b5*48*b222df06deb308bf919d13447e688775fdcab972faed2c866dc023a126cb4cd4bbffab3683ecde243cf8d88967184680
```

Password (hashcat convention for every example vector): `hashcat`.

**Sources (two independent, agreeing):**
- https://github.com/ThePacketBender/notes/blob/master/hashcat.examples.txt
- https://www.onlinehashcrack.com/tools-pdf-hash-extractor.php

Structure check: V=5, R=6, keyBits=256, P=-4, encMeta=1, idLen=16 (32 hex), uLen=48
(96 hex), oLen=48 (96 hex), no UE/OE. Well-formed.

**Note on the hashcat.net wiki value.** The official wiki `example_hashes` page currently
renders the 10700 example as a mangled 127-byte-U/O all-zeros-tail string — identical to the
fabricated placeholder that was in the test. That rendering is not a valid PDF R6 structure
and is not usable; I did **not** use it. The 48-byte U/O form above is the genuine vector.

**Strongest verification is empirical, not editorial:** the same R6 code path independently
decrypts a real AES-256 R6 fixture file (`extract_hash_round_trips_aes256_r6`). A fabricated
hash cannot pass `Hash2B` validation. The example hash passing `verify_guess(job,"hashcat")
== true` (and `"wrong" == false`) is therefore cryptographic proof the vector is authentic.

## How R6 was implemented and verified

- `verify_r6` = ISO 32000-2 **Algorithm 2.A**: user check `Hash2B(pwd, U[32..40], "") == U[0..32]`;
  owner check `Hash2B(pwd, O[32..40], U[0..48]) == O[0..32]`; true if either passes.
- `hash_2b` = **Algorithm 2.B** exactly as specified: seed `K = SHA-256(pwd||salt||udata)`,
  then loop — `K1 = (pwd||K||udata) × 64`, `E = AES-128-CBC-NoPadding(key=K[0..16], iv=K[16..32], K1)`,
  `m = (Σ E[0..16]) mod 3`, `K = SHA-256/384/512(E)` for m=0/1/2 — terminating once
  `round >= 64 && last_byte(E) <= round - 32`. Returns `K[0..32]`.
- AES-128-CBC uses RustCrypto `cbc::Encryptor<aes::Aes128>` with `NoPadding`; `K1` length is
  always a multiple of 64, hence block-aligned, so padding never applies.
- R5 (`verify_r5`) uses the same salts but a single SHA-256 (no 2.B loop).

## How legacy R2–R4 was implemented and verified

- `legacy_file_key` = ISO 32000-1 Algorithm 2: MD5 over `pad(pwd)||O[0..32]||P_le||id`
  (plus the `0xffffffff` tweak when R≥4 and EncryptMetadata=false), then 50 extra MD5 rounds
  for R≥3, truncated to the key length (5 bytes for R2, `key_bits/8` otherwise).
- `verify_legacy` recomputes `/U`: R2 = RC4(key, pad) compared to U[0..32]; R3/4 =
  `MD5(pad||id)` then 20 RC4 passes (key XORed by pass index 0..19) compared to U[0..16].
- RC4 is a small self-contained primitive (variable 5–16-byte keys) kept inline.

## parse_hash change

Relaxed the R5/R6 branch: UE/OE are parsed only when present (`fields.len() >= 15`),
otherwise left empty. `verify_guess` authenticates from the U/O salts alone, so a
password-only hashcat hash (no UE/OE) verifies correctly; a full container extraction
(with UE/OE) still round-trips.

## TDD evidence

1. Before fix: `verifies_known_r6_password` and `parse_hash_reads_r6_layout` FAILED
   (`Malformed("odd-length hex field")`) on the fabricated const; the three real-file
   round-trip tests already passed.
2. After substituting the genuine vector + relaxing `parse_hash`: 9/9 `pdf::` tests pass,
   12/12 crate tests pass. The example-hash R6 vector and both fixture round-trips are green.

## Gate output (from `crates/`)

- `cargo test -p decryption-core` → `test result: ok. 12 passed; 0 failed`
  (incl. `verifies_known_r6_password`, `extract_hash_round_trips_aes256_r6`,
  `extract_hash_round_trips_rc4_legacy`, `extract_hash_string_re_parses_to_same_fields`).
- `cargo clippy -p decryption-core --all-targets -- -D warnings` → clean (fixed three
  inherited lints: OR-pattern→`2..=4`, `% 2`→`is_multiple_of`, and a justified
  `#[allow(too_many_arguments)]` on the standard-handler key derivation).
- `cargo fmt -p decryption-core -- --check` → clean.

## Files changed

- `crates/decryption-core/src/pdf.rs` — example const, `parse_hash` UE/OE-optional, clippy fixes
  (the file also carries the full inherited Task-5 implementation, now committed).
- `crates/decryption-core/src/adapter.rs` — `KdfParams::Pdf { v, r, key_bits, p,
  encrypt_metadata, id, u, o, ue, oe }`.

## Concerns

- **None blocking.** The R6 vector is double-sourced and, more importantly, self-proving
  (it must satisfy the same Hash2B that decrypts a real AES-256 file).
- The hashcat.net wiki itself currently shows a corrupted 10700 example; downstream
  copy-paste of that value would be wrong. Documented here so future work uses the 48-byte form.
- A 10400 (R2) path is implemented but has no checked-in R2 fixture; it is exercised only
  by code review and the shared `legacy_file_key`/`verify_legacy` path that R3/R4 cover.

## Fix: legacy key_bits panic

**Commit:** `9852076` — `fix(decryption): harden PDF legacy path against crafted key length (no panic)`

### What was wrong

Two reachable panics on attacker-controlled input in the R2–R4 verification path:

1. `legacy_file_key` (R3/R4 branch) computed `key_len = (key_bits / 8) as usize` with no bound,
   then sliced `hash[..key_len]` inside a 50-round MD5 loop. A PDF declaring `/Length 256` gives
   `key_len = 32`; MD5 output is 16 bytes → `hash[..32]` panics (index out of range).

2. `rc4_apply` indexed `key[i % key.len()]` unconditionally. A `/Length 0` job produces an empty
   key vector → `i % 0` panics (remainder by zero).

### What was changed (`crates/decryption-core/src/pdf.rs`)

1. **`extract_hash`** — after computing `key_bits`, reject documents where `r <= 4` and
   `key_bits` is outside 40–128 with `ExtractError::Unsupported`. Valid RC4 key lengths for the
   legacy handler are 40–128 bits (5–16 bytes); nothing else should reach the crypto.

2. **`parse_hash`** — same validation immediately after `key_bits` is parsed from the `$pdf$`
   string. A hash string carrying an out-of-range key length is rejected as `Unsupported` rather
   than forwarded to `verify_guess`.

3. **`legacy_file_key`** — changed `(key_bits / 8) as usize` to
   `((key_bits / 8) as usize).clamp(5, 16)` as a secondary guard. If a `RecoveryJob` is
   constructed directly (bypassing the parse-time check), the MD5 slice stays within the 16-byte
   output and `rc4_apply` receives a non-empty key.

4. **`rc4_apply`** — added an early return when `key.is_empty()`. An empty key is never valid;
   leaving data unchanged causes the caller's comparison to fail (returning `false`) rather than
   panicking.

### New regression test

**`pdf::tests::legacy_malformed_key_bits_rejected_or_verify_safe`**

- Builds `$pdf$` strings for R3 with `key_bits=256` and `key_bits=0`.
- Asserts `parse_hash` returns `Err(ExtractError::Unsupported(_))` for both.
- Directly constructs `RecoveryJob` values with the same out-of-range `key_bits` (bypassing
  `parse_hash`) and asserts `verify_guess` returns `false` without panicking — exercising the
  secondary guards in `legacy_file_key` and `rc4_apply`.

### Command run and output

```
cargo test -p decryption-core pdf   (from crates/)
```

```
running 10 tests
test pdf::tests::parse_hash_reads_r6_layout ... ok
test pdf::tests::legacy_malformed_key_bits_rejected_or_verify_safe ... ok
test pdf::tests::extract_hash_round_trips_rc4_legacy ... ok
test pdf::tests::rejects_wrong_password ... ok
test pdf::tests::strips_with_correct_password ... ok
test pdf::tests::extract_hash_rejects_plain_pdf ... ok
test pdf::tests::rejects_non_encrypted_input ... ok
test pdf::tests::extract_hash_string_re_parses_to_same_fields ... ok
test pdf::tests::verifies_known_r6_password ... ok
test pdf::tests::extract_hash_round_trips_aes256_r6 ... ok

test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.40s
```

Full gate (`cargo test -p decryption-core` + clippy `-D warnings` + `fmt --check`): all clean.
13 tests pass (10 PDF + 3 other). Clippy: 0 warnings. Fmt: no diff.
