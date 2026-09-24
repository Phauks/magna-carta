---
category: Changed
audience: public
---

**The account surface states facts and builds the controls its small text was standing in for.**
`SettingDefinition.description` is optional rather than required (owner correction, 2026-09-18) and
`SettingsRow` renders the muted line only where there is one; `AccountMasthead` lost its `meta` prop
outright, since all three of its pages were restating their own headings. Three of the four rows the
`account-seams` guard was written for are built, so that guard now tests the named seam rows
(Two-Factor) rather than disabling every control on a page that carries one.

- **Profile · Photo.** `member_photo` in the per-firm database keyed by the member's user id, bytes
  in the firm's bucket under their own SHA-256, `me.photo` / `me.setPhoto` / `me.removePhoto` and a
  content route beside them. Content-addressed and written object-first, the firm brand-image
  reasoning. Registered in the PII registry as a hard-delete at the subject, with the note that the
  row is the only thing naming the object.
- **Security · Password.** Better Auth's `/change-password` behind the product's action panel, with
  `revokeOtherSessions` offered and defaulted on. `password.changed` joins the auth audit through an
  endpoint after-hook — `internalAdapter.updateAccount` passes no context to the account hooks, so
  the endpoint is the only place the door has a name, and the hook guards on the returned value
  because an after-hook runs over failed requests too.
- **Profile · Identity.** The address is engraved from the session bootstrap. No change control: the
  decision and what a change would actually cost are in `docs/decisions/pending/`.

`advanced.ipAddress.ipAddressHeaders` now reads `cf-connecting-ip` ahead of `x-forwarded-for`. The
library's default reads the latter alone and, with no trusted-proxy list, refuses any multi-hop
value — which is the only shape Cloudflare sends — so every session recorded an empty address. The
signed-in-devices row omits the clause where one is genuinely absent, and `REVOCATION_LAG_NOTE` and
`UNRECORDED_ADDRESS` are gone with the banner and the caption that carried them.

`member-name-api.ts` moved onto the generated client and `member-photo-api.ts` was written on it, so
the `lint:screen-data` hand-written-transport budget stayed flat at 56; the adapter both use
(`outcomeOf`) lives at the seam.

## Public

**Account Settings says less and does more.** The muted line under every row's name and the sentence
under every page's heading are gone — the surface was explaining its own headings back to you. What
replaced the explanations is the things they were explaining being built:

- **A photo.** Choose a PNG or a JPEG on Profile and it is yours across the firm; change it or remove
  it from the same plate.
- **A password change.** Security changes the password you already have, with no emailed link — and
  signs your other devices out in the same act when you ask it to, which is the thing that matters on
  the day you think somebody else has your account.
- **Your email address**, stated on Identity. Changing it is not offered yet: it is the address you
  sign in with and the one every pending invitation is addressed to, so it is a piece of work rather
  than a field, and a greyed-out box beside it would have claimed otherwise.

**Active Sessions shows where each device signed in from.** It never had — every row said "Address
not recorded", because the site was reading a header it is never sent. A device whose sign-in
genuinely carried no address now simply has one fewer thing said about it. The notice at the top of
that screen has gone too: it told you to go and find a password reset, and the password change is
now one click away on Security.
