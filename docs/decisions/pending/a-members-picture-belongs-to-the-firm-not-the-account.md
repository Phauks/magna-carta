---
slug: a-members-picture-belongs-to-the-firm-not-the-account
status: Accepted
area: Account
date: 2026-09-18
summary: "A member's photograph is stored in the FIRM's database and the firm's bucket — a member_photo row keyed by the member's user id, bytes under their own SHA-256 — rather than on the control-plane account beside the member's name. The name is an account fact a person carries between firms; a picture is what this firm's colleagues see beside this person's work, and it is already firm-keyed by its storage. Better Auth's user.image column is deliberately left unused: it holds a URL, and a URL to a firm-scoped object read through a session is not something the control plane can resolve. The row is keyed by the member rather than by the bytes, unlike firm_brand_image, because two members may legitimately hold the same image."
---

**A member's picture is firm data, keyed by the member. Their name is account data. The split is not symmetry for its own sake — it is where each fact is read from.**

**Context:** The account profile had an Avatar row as a disabled seam whose stated blocker was "an avatar needs a store that does not exist". The store did exist: the firm's own R2 bucket, with a worked precedent in `firm_brand_image` — content-addressed bytes, a row carrying what a screen needs to draw them, written object-first.

What had to be decided was which side of the tenancy line the picture sits on. The member's own NAME is deliberately control-plane (`routes/me-name.ts`): it is the account's, it rides Better Auth's `user.name` column, and it is mirrored into the firm's `member.display_name` for the roster. The obvious move was to follow it — Better Auth even ships a `user.image` column for exactly this.

**Decision:** The picture lives in the FIRM. A `member_photo` row in the per-firm database, keyed by the member's global user id, carrying the bytes' SHA-256, the object key, the content type, the intrinsic pixel size and the instants; the bytes in the firm's bucket under `member-photo/<sha256>.<ext>`, stamped with a new `member-photo` firm-scoped object class.

Three things decided it. The picture is read where the firm is: it is what colleagues see beside this person's work, and every reader of it already holds a firm context. Its storage is firm-keyed by construction — the bytes are in the firm's bucket under the firm's key, so a control-plane row pointing at them would be a control-plane row that only a firm request can resolve. And a person who leaves takes their name to their next account and leaves the firm's roster photograph behind, which is the honest behaviour rather than a consequence to be worked around.

`user.image` stays unused, and that is worth stating rather than leaving as an absence: it holds a URL, and the only URL this platform can offer is a session-authenticated firm-scoped route, which is not a thing the control plane can resolve or a third party can fetch.

The row is keyed by the MEMBER, where `firm_brand_image` is keyed by its bytes. Two members may legitimately hold the same image — the same placeholder, a firm's own silhouette — and content-keying would make one member's upload silently become the other's row. One row per member is also what makes "no picture" an absent row rather than a row of nulls, and what makes a replacement an upsert rather than a delete-then-insert that could be interrupted in the middle and leave somebody with nothing.

The write takes `firm:editOwnProfile`, the same key the member's own name takes — seeded to every default role including Read-only, because a picture of oneself is not a privilege — and every statement binds the session's own user id, which is what makes that key safe to give everybody. The removal declares `me.setPhoto` as its reversal: uploading one again is the way back, and it is the same act a person performs to change a picture at all.

**Considered and rejected:** **The control-plane `user.image` column**, for the reasons above — it wants a URL, and there is no URL to give it. **Content-addressing the row the way the firm's marks are**, which collides two members who upload the same bytes. **Columns on the `member` row** rather than a table of its own: seven mostly-null columns on the row that every permission read joins against, carried by every one of those reads to answer a question none of them asks. **Returning the bytes inline on the profile read**, which would make every visit to the page that asks "do I have a picture" cost the picture.
