---
worktree: /home/user/magna-carta (remote session)
area: Account Settings — the small text, the multi-select that took one, the picture, the address, the password, the email
status: review
touches: apps/web/src/lib/account/, apps/web/src/lib/names/, apps/web/src/routes/account/, apps/web/src/lib/settings/components/settings-row.svelte, apps/web/src/lib/settings/settings-definitions.ts, apps/web/src/lib/api/api-client.ts, apps/api-worker/src/auth.ts, apps/api-worker/src/routes/me-photo.ts, packages/database/src/per-firm-schema.ts, packages/data-access/src/pii-registry.ts, packages/object-dimensions/src/dimensions.ts
---

The owner's pass over Account Settings, 2026-09-18. Six corrections and one question.

The **small text** is gone from the whole surface: the muted descriptor under each row's name, and
the one-line meta under each page's heading. `SettingDefinition.description` is optional now rather
than required, and the account pages state none — a firm SETTING earns a descriptor because a
firm-wide choice has consequences a name cannot state, and "Prefix" does not.

The **prefix/suffix dropdown** said it took several and took one. A settled line was being read as a
search, so after picking "Hon." the list narrowed to "Hon." and every other suggestion was
unreachable. The judgement moved out of the component into `$lib/names/honorific-line.ts`, where the
sequence a person actually performs is pinned.

A member's **picture** is built: `member_photo` in the per-firm database, the bytes in the firm's
bucket under their own hash, `/api/v1/me/photo` and its content route, and a plate on Profile.

**Active Sessions** recorded no address on any row, because Better Auth's default reads
`x-forwarded-for` alone and refuses a multi-hop value — which is the only shape Cloudflare sends.
It reads `cf-connecting-ip` now; where an address is genuinely absent the caption leaves the clause
out rather than naming its own absence. The revocation-lag notice came off with the rest of the
explanatory text; the remedy it pointed at is a control now.

**Security** changes a password in place, against the standing password, ending every other device
in the same act when asked to. `password.changed` joins the auth audit.

**Identity** states the account's email address. It does not change it, and that is a decision
rather than an unfinished seam — recorded in `docs/decisions/pending/`.

Nothing here is shared with another stream, with two exceptions worth knowing: `settings-row.svelte`
and `settings-definitions.ts` are the settings surface's own files, and `api-client.ts` gained one
exported helper (`outcomeOf`).
