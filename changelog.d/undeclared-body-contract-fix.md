---
category: Fixed
---

**Two endpoints that read a file from the request body now say so in the published API description.**
The file-hashing endpoint and the one-off malware-scan diagnostic both take the file's raw bytes as the
request body — that is the whole input — but the API description declared no request body for either, so
anyone building a client from the published description got a method with nowhere to put the file. Both
now declare the same raw-bytes body the other file tools declare, and the generated client accepts and
sends the bytes unaltered. No behaviour changed on either endpoint: they still stream the body straight
into the hasher or the scanner without buffering it, still refuse an empty body, and still refuse a file
over the firm's inspectable-size limit before reading it.

Both endpoints keep treating an idempotency key as optional, and that is deliberate rather than an
oversight left in place. The platform's key-required gate identifies a repeat request by reading its body
through a cache that decodes it as text, which does not preserve arbitrary bytes — so an endpoint whose
body is a file cannot use that gate without risking hashing or scanning something the caller never sent.
Neither endpoint stores anything, so a repeated request simply recomputes.
