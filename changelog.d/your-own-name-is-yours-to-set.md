---
category: Added
audience: public
---

**A member's own name is live, and it is held as parts.** `GET`/`PUT /api/v1/me/name` over five new nullable columns on the control-plane `user` row (`name_prefix`, `name_given`, `name_middle`, `name_family`, `name_suffix`), with Better Auth's `name` kept as a real column and RENDERED from the parts in the same statement — so what the platform prints and what the person stated cannot drift. `packages/directory/src/person-name.ts` owns the join, and `entity-display.ts` now calls it too: one rule, so a Directory person and a member read as the same person.

The write brings the per-firm `member.display_name` mirror along, control plane first and roster second: a failed mirror leaves the account correct and the roster one save behind, which the next save repairs, where the reverse ordering would show colleagues a name nobody saved.

`firm:editOwnProfile` is new in the permission registry and seeded to every default role including Read-only. It exists because the chokepoint refuses an authenticated mutation naming no permission and the platform has no self-scoped mutation concept — the gap `member-profiles.ts` documented in its own header, which is why a member could not correct the spelling of their own name. Every statement behind it is scoped to the session's own user id.

Registration carries the parts it already collects. The joining screen asks for a first and a last name and used to join them with a space; `registration.name_given` / `.name_family` carry them to the `user` row at confirmation, so an account created from today never needs a split.

**Nothing splits an existing name on the server.** `me.name` answers `partsStated: false` and null parts for an account that predates the columns; the profile screen offers `splitNameForReview` as a form seed the person confirms. Storing that reading would be inventing a fact about somebody's name.

Prefix and suffix also take several honorifics: the control edits one comma-separated line, picking from the list appends rather than replaces, and picking a held entry takes it off.

## Public

**Your name is yours to set, and it now has proper parts.** Account · Profile is live: prefix, first, middle, last and suffix, with the line they read as shown beneath so you can see exactly how you will appear before you save.

If your account was made before this existed, it holds the one name you typed when you signed up. The page shows you how that reads as parts and asks you to confirm or correct it — nothing is stored until you press Save, because guessing at somebody's own name is not something software should do quietly.

Prefix and suffix both take several: "III, Esq." or "M.D., Ph.D." Pick them from the list one at a time, or type the line yourself.

Changing your name updates it everywhere in your firm — the roster, and every screen that names you on the work you did.
