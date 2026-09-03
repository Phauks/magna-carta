---
category: Fixed
audience: internal
---

A firm whose bucket is not the one bound to this Worker can be read and written again.

Provisioning has minted a bucket per firm since the beginning; the Worker binds one. R2 bindings are static configuration and no runtime API turns a bucket name into a handle, so the resolver refused rather than write a firm's bytes where no read path could reach them — which took uploads and the download shelf down for every provisioned firm, not just the one in the log.

`resolveFirmBucket` now returns an S3-API-backed handle for a bucket the Worker has no binding to, signed with the account-scoped credential that already reaches every bucket in the account. The bound bucket still resolves to its binding, so the common path pays no signing round trip and no network hop. Firm creation stays off the release path: a firm provisioned at 2 a.m. is readable at 2 a.m., with no config commit and no deploy.

The adapter is written to the surface its callers use and refuses the rest out loud rather than quietly. Where the S3 API cannot answer what the binding would — a listing carries no user metadata — it does the extra work instead of returning a plausible wrong answer, because the sweep that reads metadata off a listing decides from it whether a firm's whole bucket needs rewriting.

Provisioning also applies the firm bucket's expiry rules now: bundles at seven days, conversion results at twenty-four hours, and abandoned multipart uploads at twenty-four hours. Firm buckets previously got none of them, so every artifact a firm had ever downloaded or converted accumulated, metered, forever.
