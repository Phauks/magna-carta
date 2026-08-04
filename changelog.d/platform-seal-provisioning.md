---
category: Added
---

**The platform seal can be provisioned: one command mints the signing identity.**
`pnpm run platform-seal-certificate` generates the RSA-3072 signing key and the self-signed X.509 v3
certificate the seal is applied with, then prints the two `wrangler secret put` commands that activate
the sign worker. The certificate carries what a document-signing certificate is expected to carry —
`basicConstraints` (not a CA), `keyUsage` restricted to digitalSignature + contentCommitment,
`extendedKeyUsage` of id-kp-documentSigning (RFC 9336), a subject key identifier computed without
SHA-1 (RFC 7093), a random positive serial, and a proper one-attribute-per-RDN name. The private key is
written to a `0600` file and never printed, so it never passes through a shell argument, scrollback, or
a transcript. The generator is a tested library function (`@magna-carta/signing/platform-certificate`),
not a script: its test re-imports the exported key non-extractably and proves the resulting CMS
verifies, so what provisioning produces is known to seal before it ever reaches a secret store.
