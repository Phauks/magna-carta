---
category: Added
audience: public
---

**The per-firm credential read is built, and the five shipping operations that answered 501 now run.** A connected integration's credential lives in its own per-firm `integration_credential` table under a new `integrations:useConnection` permission, rather than in `firm_secret` under `firm:manageSecrets`. That separation is the whole change: a protected column carries exactly one declaration and that declaration's permission IS the decrypt gate, so while the two shared a column the routes gating on `shipping:manage` would either refuse the member they had just admitted or be fixed by granting that member read access to every secret the firm holds. `firm_secret` keeps its administrator gate untouched. A store may now raise exactly one error, `CredentialAccessForbiddenError`, which the registry turns into a `credential-forbidden` dispatch outcome, so `resolve` keeps its promise never to throw and the route answers 403 naming the grant instead of a 500. The shipping end-to-end test drives the real store rather than a fake; disconnect clears the credential in the same batch as the connection row. Reasoning: `docs/decisions/pending/a-credential-used-on-a-members-behalf-is-not-a-secret-they-may-read.md`.

## Public

**Your firm can connect its postage account and use it** — compare rates, buy a label, track the parcel, and refund one you did not use. Postage lands on the matter as a recoverable cost, as it always did.

Whoever does your mailing can do this without being given the keys to everything else your firm has stored. If someone may create shipments but has not yet been allowed to use the postage account, they are told exactly that, and which permission to ask for.

Drafting a shipment never required the account and still does not.
