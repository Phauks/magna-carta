---
category: Added
---

**Captured email is now checked against its DKIM signature, and the filing API is hardened for the
add-in.** A message filed to a matter carries a recorded verdict on whether its signature verifies,
which domain signed it, and — when it does not verify — why: unsigned mail, a message file with no
signable original, a signing key that has rotated away, and a resolver outage are each recorded
distinctly rather than collapsed into one answer. The verdict is **informational**: nothing is
dropped, quarantined, refused, or auto-filed on the strength of it, and a forwarded copy failing
verification (forwarding rewrites headers, which breaks the original signature) says nothing against
the sender. Verification is RFC 6376 over WebCrypto inside the platform, off the request path — no new
dependency, and the mail parser keeps its parse-only, network-free boundary.

The authenticated `file this email to a matter` endpoint — the one the native add-in's Save & File will
post to — now honours an `Idempotency-Key`, so a retry from a mail client on a flaky network converges
on the capture it already started instead of staging a second copy, and a key reused with different
bytes is refused rather than answered with the first capture. It also refuses, at the door and
with a reason the caller can act on, a payload that is not an email, a message past the capture size
limit (measured from the bytes received, not a declared length), and a matter the caller cannot resolve
— all previously accepted and left to fail out of sight in the background consumer. Both capture
entrances now share one size ceiling, and a client can declare itself as the add-in so a capture that
preserved the original message is distinguishable from a manual upload.
