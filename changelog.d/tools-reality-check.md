---
category: Fixed
audience: internal
---

**Nineteen tools were counted as built and none had ever been run. Eleven return a verified-correct
answer, seven wait on a deploy, one is broken by an unbuilt seam rather than a missing deployment —
and exactly two have a page a person can open.**

`shipped` in the feature ledger means the artifact exists on `main`. That is an honest definition and
it is not the same claim as "a person can use this and get a right answer", so the Tools catalog was
traced end to end — manifest, route, package, and whatever each reaches outward for — and every tool
exercised against a local Miniflare worker with a real session and against the real internet. Where a
thing could not be determined the audit says so:
[`docs/research/2026-08-15-tools-reality-check.md`](docs/research/2026-08-15-tools-reality-check.md).

**Answers checked against something independent, not against a 200.** File hashing returned all five
digests byte-identical to `md5sum`/`sha1sum`/`sha256sum`. The metadata scrubber found a `.docx`'s
author and company, removed both, and left the body text intact — verified by unzipping the result.
File decryption produced a well-formed `$pkzip2$` hash at the correct hashcat mode 17210 and unlocked
the archive to its exact original plaintext. WHOIS matched public record for six targets including
`example.com` (1995-08-14, IANA) and `cloudflare.com` (2009-02-17, Cloudflare Inc.). The email
inspector round-tripped every header of a hand-written message. Firm usage matched the seeded firm's
counts exactly. County property records deep-linked to a real Clark County parcel whose own page
confirms the APN, and the attorney-licence and business-registry links resolve to the correct
official searches.

**One repair, because it was small and certain.** A WHOIS lookup for a registry publishing neither an
RDAP service nor a port-43 host answered `500 Internal Server Error` with an Error ID to quote at
support. Measured against the live IANA lists that is **234 of 1,438 TLDs** — `.ch`, `.at`, `.jp`,
`.ru`, `.ae` among them, one lookup in six. It is now a typed `UnsupportedRegistry` answered as `501`
with plain guidance, and — the half that makes the fix visible — the page classifies 501 as
information rather than as our fault, since it shows the Error ID only on a danger tone.

**The one thing no deploy fixes.** Shipping's rate-shop, purchase, tracking and refund all return 500
because the per-firm credential read is an unbuilt seam (`firmSecretStoreNotYetAvailable`), not an
unset secret. Connecting a real EasyPost key changes nothing. Draft creation succeeds regardless, so a
member can create a shipment that can never be bought.

**And one deploy hazard nobody had recorded.** `apps/api-worker/wrangler.jsonc` binds
`OCR_SERVICE -> magna-carta-ocr`, Cloudflare rejects a deploy whose service binding names a missing
Worker, and that worker appears in no Workers Builds connection list, no placeholder list, and no
deploy queue. Either it exists and nothing says so, or the next app-worker push is rejected outright —
blocking every tool in the catalog. It is now the first item in `docs/deploy-queue.md`, ahead of the
four other tool steps: the scan worker (which unblocks the file type verifier and the malware scan
together), the file-repair worker (whose Build Watch Paths point at a directory that does not exist,
so its image never rebuilds), Browser Rendering for the safe website viewer, and the Pangram key last.

**Findings left as findings, with evidence rather than a patch:** the port-43 WHOIS socket has no read
deadline; the email inspector reports an HTML body for a `text/plain`-only message; `scan/diagnose`
500s where the sibling `file-type` route 503s on the identical unreachable engine; the file converter
cannot be exercised end to end under `wrangler dev` at all, because the dev upload route only accepts
keys minted as pending file versions; and property links silently drop state and ZIP from a partial
address, which is how one Las Vegas becomes another.

Ledger notes corrected on eight nodes so each says what a person gets today. No node's `status`
changed — the ledger's own convention counts a backend-only capability as shipped with a note, and
what was wrong was the silence, not the statuses. `docs/now.md` regenerated from the ledger.
