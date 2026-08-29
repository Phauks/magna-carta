---
category: Added
audience: public
---

**The matters list now names the responsible attorney**, and every screen that has to put a name to a colleague can.

`GET /api/v1/members` answers the firm's roster — display name, whether the member is still here, the roles they hold, and whether a professional profile has been written. No email address, no direct dial, no permission set: it answers who is on the firm, not how to reach them or what they may do. It rides its own capability, `firm:readMembers`, seeded to every default role including Read-only — adding a person to the firm is Owner/Admin's, and knowing who is already in it is not the same act. The read is un-paged, because a roster is bounded by the firm's headcount rather than by its activity, and a listing joining names against it has to have the whole lookup before any row renders honestly.

The docket's new **Responsible Attorney** column resolves that identifier the way Practice Area and Location already do — one roster read per screen, never a request per row. A matter whose responsible member the roster cannot name reads empty rather than printing a `user_…` handle, and a colleague who has left is still named on the matters they carried. The column had been left off the list entirely, with a note on the page saying why; the note is gone.

Two repairs travelled with it, both of the same kind — an account nobody can sign into:

- **Signing in worked only from the production origin.** Declaring the deployment's public URL had, as a side effect, made it the only origin the sign-in endpoint would accept a request from — so `wrangler dev` on localhost, a preview deployment, and every test that signs in were refused with "Invalid origin". The origin a request actually arrived at is trusted again, alongside the configured one; a genuine cross-site request still carries somebody else's origin and is still refused.
- **The development seed left a passwordless account.** Re-seeding against warm local state found the existing user and skipped its credential, then printed a password that did not work. The seed now converges every field it promises — firm attachment, verification, and the credential — so a re-seed repairs an unsignable account instead of reporting success for one.

## Public

**The matters list now shows who each matter belongs to.** A new **Responsible Attorney** column names the colleague the matter is filed under, and it can be sorted, filtered and hidden like any other column. A colleague who has left the firm is still named on the matters they carried, because that is who held them. Where the person on a matter is not on your firm's member list, the cell is left blank rather than showing an internal reference that means nothing.

The same firm member list now sits behind the people-pickers elsewhere in the app: the colleagues offered when you report an issue, or ask an administrator to change a setting, are your firm's real colleagues with the role each one holds shown beside their name — not a sample list. Every member of the firm can read it, whatever else their account is allowed to do; it shows who works here, never anyone's contact details or what they are permitted to change.
