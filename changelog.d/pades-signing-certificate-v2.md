---
category: Added
---

**The PAdES seal now carries the ESS signing-certificate-v2 attribute — the baseline is complete.** The
detached CMS gains the `signing-certificate-v2` signed attribute (RFC 5035): a hash of the signer
certificate's DER, bound into what the signature covers, so the seal is tied to _this_ certificate and
not just its issuer-and-serial (closing the certificate-substitution gap a PAdES-baseline signature must
close). pkijs has no `SigningCertificateV2` type, so the `SigningCertificateV2`/`ESSCertIDv2`/`IssuerSerial`
structure is built directly, omitting the `hashAlgorithm` for the SHA-256 default per DER and including it
for SHA-384/512. Verified in node and on the Worker runtime: the attribute's hash matches the certificate,
and the seal still verifies end to end.
