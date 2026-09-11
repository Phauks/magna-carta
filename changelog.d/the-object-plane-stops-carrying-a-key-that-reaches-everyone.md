---
category: Security
audience: internal
---

**A firm's objects are reached with a credential scoped to that firm's bucket, not one that reaches
every bucket in the account.**

A firm's bucket cannot be a binding, so the Worker signs S3 calls — and until now it signed them with
the parent R2 key, which addresses every bucket in the account for as long as it exists. That is
wider than the work: a request serving one firm's file has no business being able to address another
firm's bucket at all. `firm-bucket-credentials.ts` mints a credential derived from that parent,
scoped to one bucket, with a lifetime, and `object-read-write` rather than any admin permission — so
it cannot touch the bucket's own configuration either. A leak on the object plane now exposes one
firm for a window, where it used to expose the account.

The credential is a RESOLVER on `createS3FirmBucket`, not a value, which is what lets it be re-minted
mid-life without anything reconstructing the handle — and costs nothing, because every call there was
already awaiting a signature.

**The rule that is not obvious:** a presigned URL dies with the credential that signed it, whatever
its own `X-Amz-Expires` says, and R2's mint response carries no expiry at all — only the `ttlSeconds`
asked for. So the expiry is computed at mint time and every hand-out re-checks that the credential
outlives what is about to be signed with it, with margin. Skip that and a member gets an upload URL
good for an hour that stops working in four minutes, which reads exactly like the storage refusing
the upload and is diagnosed the same slow way.

Selection is by the presence of the provisioner's existing token — no new secret, and no code path
that only runs in production. Until it is set this behaves exactly as it did. A minting failure is
never answered with the parent key: falling back would make the narrowing decorative.

Still on the parent key: the PRESIGNER, which signs the URLs the browser follows. Same treatment,
plus `appendSessionToken` so the query-signed URL carries `X-Amz-Security-Token` — a separate change
because it is the browser-visible surface.
