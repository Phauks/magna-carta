# File Hash & Integrity

Produce a file's cryptographic fingerprints, and confirm a stored file is exactly what it was when it entered Magna Carta.

## What it does

A cryptographic hash is a fingerprint of a file: a short string of letters and numbers, calculated from every byte, that changes completely if even one byte of the file changes. If two files have the same hash, they are the same file; if the hashes differ, the files differ — there is no in-between. Courts, opposing counsel, and e-discovery vendors rely on hashes to prove that a produced file is the exact file that was collected, untampered.

This tool does two things:

- **Generate hashes** — drop in any file and get all five common fingerprints at once. Use them to hand a verifiable fingerprint to a court or opposing party, to confirm a download matches a published checksum, or to check that a file you received matches a hash someone gave you.
- **Verify integrity** — for a file already stored in Magna Carta, re-calculate its fingerprint now and compare it to the fingerprint recorded the moment the file was first taken in. A match proves the file has not been altered or corrupted since. Every verification is recorded as a permanent entry — who verified the file, when, and the result — and produces a downloadable **receipt** you can keep or attach to a production.

The tool never stores a file you drop in to hash; it works on the file, shows the result, and discards it.

## The five fingerprints

| Fingerprint           | Use it for                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **SHA-256**           | The primary, recommended fingerprint. This is the one Magna Carta records and compares against.                                                                                                                                                                          |
| **SHA-384 / SHA-512** | Stronger variants, when a recipient specifically asks for them.                                                                                                                                                                                                          |
| **MD5 / SHA-1**       | Older fingerprints, kept for compatibility — many e-discovery load files and opposing-party tools still require them. They are fine for matching and identification but are **not** secure against deliberate tampering; rely on SHA-256 when integrity is what matters. |

All five are produced from a single read of the file, so asking for every fingerprint costs no more than asking for one.

## Common tasks

**Get a file's fingerprints**

1. Open the Tools sidebar.
2. Select **File Hash & Integrity** under **Documents**.
3. Drop in the file (or pick it with the file picker) and select **Generate all hashes**.
4. All five fingerprints appear, with the file's size. Copy any of them to share.

**Check a file against an expected hash**

1. Generate the file's hashes as above.
2. Paste the hash you were given (from a court order, a vendor, or opposing counsel) into the **Expected hash** field.
3. The tool tells you whether it matches — and which fingerprint it matched.

**Verify a stored file's integrity**

1. Find the file in Magna Carta and open its actions (right-click or the file's menu).
2. Select **Generate all & verify**.
3. The tool re-reads the stored file, calculates its fingerprints, and compares the SHA-256 to the one recorded when the file came in. You get one of three results:
   - **Match** — the file is byte-for-byte identical to what was taken in. It has not been altered or corrupted.
   - **Mismatch** — the file differs from what was recorded at intake. Treat this as a red flag and investigate (see below).
   - **No baseline** — no fingerprint was recorded for this file at intake, so there is nothing to compare against. The current fingerprints are still shown.
4. All five fingerprints are listed whichever result you get. Click one to copy it.
4. Download the **receipt** — a record of the file, its fingerprints, the result, and the time of the check.

## Tips and edge cases

- **A "mismatch" is significant.** It means the file's bytes are not what they were when the file entered Magna Carta. This is exactly what integrity verification exists to catch. Do not produce or rely on a mismatched file until you understand why it changed.
- **Magna Carta watches for this on its own, too.** If a stored file's contents are ever replaced after intake, Magna Carta notices and pulls that version out of circulation — it is marked quarantined and stops being downloadable, rather than being served as though it were the file that was checked in. Verifying by hand is still how you produce a receipt for a court or an opposing party.
- **MD5 and SHA-1 are for compatibility, not security.** Use them when another system requires them. When you need to _prove_ integrity, use SHA-256.
- **"No baseline" is not a failure.** It simply means the file has no recorded fingerprint to compare against — most often because it was very large and skipped automatic inspection when it came in. The tool still gives you its current fingerprints.
- **Verification is part of the record.** Each time you verify a stored file, Magna Carta keeps a permanent entry of who ran the check and what the result was — without ever storing the file's contents. The receipt is your portable copy of that entry.
- **Very large files.** Verifying an extremely large stored file is refused with a clear message rather than running indefinitely.
- **The fingerprint identifies content, not the file name.** Renaming a file does not change its hash; editing its contents does.

## Related features

- **Metadata Inspector & Scrubber** — remove hidden information from a file before you produce it; pair with a hash to fingerprint the cleaned copy.
- **Tools** — File Hash & Integrity is in the **Documents** group of the Tools sidebar, and is also available as an action on any stored file.
