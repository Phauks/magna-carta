---
number: 226
slug: binary-body-route-idempotency
status: Accepted
date: 2026-08-05
area: Worker / API contract
summary: "A route whose request body is raw bytes declares `idempotency: \"optional\"` and honours the Idempotency-Key in its own handler, against the bytes it received — it must NOT declare `idempotency: \"required\"`. The chokepoint's required-idempotency gate fingerprints a request by reading its body through Hono's body cache, which caches the decoded TEXT; a later `arrayBuffer()` is then re-encoded from that text, so a `.msg` or any 8-bit message would reach the handler UTF-8-mangled and be stored as the firm's verbatim original in that corrupted form. The handler-side form keeps the same guarantees (replay returns the stored response, a key reused with different bytes is refused) with the fingerprint taken over the received bytes, and the derived job id makes every layer below converge on a retry whether or not a key was sent."
---

**A raw-bytes route honours idempotency in its handler, never through the chokepoint's required-idempotency gate.**

**Context:** The authenticated file-to-matter email endpoint takes raw `.eml`/`.msg` bytes as an `application/octet-stream` body, and the client it exists for — the native mail add-in — is expected to queue and retry over whatever network a mail client happens to be on. That is exactly the case `idempotency: "required"` was built for, and declaring it looked correct. It is not: the chokepoint's gate derives its fingerprint by calling `req.json()`, which populates Hono's body cache with the *decoded text*, and every later body read is re-encoded from that cached text. Binary bytes do not survive the round trip. A `.msg` export would arrive at the handler with every invalid UTF-8 sequence replaced, be written to storage as the message's verbatim original, and hash to something that matches nothing — a silent corruption of the one artifact the record model exists to preserve.

**Decision:**

1. **`idempotency: "optional"` on any route whose body is not JSON**, with a comment at the declaration saying why, so the next reader does not "fix" it back.

2. **The handler runs `runIdempotentEffect` itself**, keyed on the client's `Idempotency-Key` and fingerprinted over the bytes it actually received. This preserves what the gate provides — a replay returns the stored response, a key reused with a different payload is refused rather than silently answered with the first result — and takes the fingerprint from the real payload rather than from a re-read of it.

3. **The job id is derived from the key, and side effects are re-applied on the replay path.** Hashing (firm, resource, key) into the background job's id makes the staged object, the queued message, and the consumer's own idempotency record all converge on a retry. Because they do, staging and enqueueing are performed on a replay too — a first attempt that committed its record and then died before enqueueing would otherwise leave work the firm never receives and a retry that cheerfully reports success.

4. **No key is still a valid request.** A caller that sends none gets a freshly minted job and the pre-existing behaviour: each submission is its own capture. The key buys convergence; it is not a new requirement placed on existing callers.

**Consequences:** The route's declared meta says "optional" while its behaviour is stronger than optional, which is why the reason is recorded at the declaration and here rather than left to be rediscovered. A general fix — a fingerprint path that hashes the raw body without decoding it — would let such routes use the gate normally and is worth doing when a second binary-body route needs idempotency; one route does not justify changing the shared gate.
