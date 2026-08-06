---
slug: matter-asset-identifier-decrypt-permission
status: Accepted
area: Matter assets
date: 2026-08-06
summary: "A matter asset's full account, policy, certificate, or tax number is sealed under the EXISTING sensitive-identifier decrypt permission (`directory:viewSensitiveIdentifiers`) rather than under a third `matterAssets:*` key. The asset design's permission answer is a two-key pair — `matterAssets:read` and `matterAssets:manage` — with the protected read 'separately gated by the existing decrypt permission through the protected() chokepoint'; it does not name which existing key that is, and the two candidates (reuse the directory key, or mint a third asset key) are a real choice. Reuse wins: it is the same class of secret about the same people, a firm that has decided who may open a client's account number has not decided that twice, and a second key would be seeded carelessly or left unseeded — which is how a gate stops meaning anything. No blind index is declared on the column, deliberately."
---

**A sealed asset identifier opens with the sensitive-identifier decrypt permission the platform already has, and no blind index is declared on it.**

**Context:** The matter asset register seals full account, policy, certificate, and tax numbers in
`matter_asset_identifier.value_ciphertext`, a registered protected column, with only a four-character
suffix readable anywhere else. The design settles the permission family as a **pair** —
`matterAssets:read` and `matterAssets:manage` — having explicitly rejected a four-key family on the
grounds that it "adds gates no workflow needs and keys that get seeded carelessly", and says the full
read "is separately gated by the existing decrypt permission through the `protected()` chokepoint …
That is the third gate the four-key option was reaching for, and it already exists." It does not say
which existing key. Two answers are live: reuse `directory:viewSensitiveIdentifiers`, the key that
already opens a Directory entity's social security number, employer identification number, driver's
licence, and account number; or mint a third asset key and leave the pair a pair only in name.

**Decision:** (1) **The protected-field declaration for `matter_asset_identifier.value_ciphertext`
carries `directory:viewSensitiveIdentifiers`.** It is the same class of secret about the same people:
an account number on a decedent's brokerage account and an account number on the decedent's Directory
record are the same fact with two homes, and a firm that has decided who may open one has not decided
that question twice. Minting a third key would produce exactly the failure the design rejected the
four-key family for — a key that is either seeded to everyone who might need it (so it gates nothing)
or seeded to nobody (so the read is unreachable and somebody adds a workaround). Reuse also keeps
`matterAssets:read` honest: a member who can read the whole register still cannot open a single full
number, which is the property the split exists to produce.

(2) **The route's own permission stays `matterAssets:read`, and the decrypt gate is the chokepoint's.**
`GET /api/v1/matter-assets/{assetId}/identifiers/{identifierId}/value` carries `matterAssets:read` in
its route metadata, because the resource it names is a matter and the `matterAssets:*` namespace binds
`matter`. The decrypt permission is checked by the data-access protected-field chokepoint, which is
the one place a decrypt is decided anywhere in the platform: the permission gate refuses before any
decrypt and before any audit row, then the audit row commits before any plaintext exists. A caller
without the key gets a named 403, never a blank — an empty field would read as "there is no account
number", which is a different and wrong answer. Binding the route itself to the directory key would
have forced `directory` into the resource map for a matter-scoped path, which is a worse lie than the
one it would have fixed.

(3) **No blind index is declared on the column.** Every other decision here reuses the Directory
identifier's shape; this one deliberately does not. A blind index is an exact-match channel that takes
**no permission and writes no audit row**, because matching reveals nothing the caller did not already
supply — which is true for the Directory, where the caller is running a conflicts check against a
value they hold, and false here, where a caller holding a number could confirm which matter holds it
without a gate and without a trace. Nothing in this subsystem looks an asset up by identifier value;
the identifiers people search by (a parcel number, and later a vehicle identification number, a plate,
a firearm serial) are plaintext columns precisely because they are public record.

**Consequences:** A firm grants one key for "may see a client's sensitive numbers" and it covers both
registers, which is the mental model a firm administrator actually has. If a firm ever needs the two
separated — a paralegal who may open an estate's account numbers but not a client's tax
identification number, or the reverse — that is a new key added then, against a real requirement, and
it is additive: the declaration changes in one place, and the chokepoint enforces the new key
everywhere the column is read, because there is exactly one reader. The absent blind index means no
"which matter holds this account number" lookup exists; adding one later would be a deliberate
decision with its own audit and permission answer, not a silent consequence of the column growing an
index.
