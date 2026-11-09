---
category: Added
audience: public
---

**The profile menu's Websites > Changelog opens an in-app Changelog screen at `/updates`.** `apps/web/src/routes/(app)/updates/+page.svelte` renders `docs/public-changelog.md`, imported as text into the web bundle and parsed by `buildPublicChangelogArtifact` from `@magna-carta/product-updates` (now an `apps/web` dependency), so every build carrying an `audience: public` fragment updates the screen with no further step. Entries are grouped by date and category with a category filter; their Markdown is read by a small inline parser (`apps/web/src/lib/product-updates/changelog-text.ts`) into nodes rendered as plain Svelte text, never `{@html}`, and repository-relative links keep only their words. `EcosystemSite` gains an optional `route`: while a site's `href` is null, the profile menu and the command palette open that in-app screen instead of showing "Soon".

## Public

**See what changed, inside Magna Carta.** Choose your avatar at the top right, then **Websites** and **Changelog**, to read every change made for you, newest first and grouped by date. Filter to Added, Fixed or another kind of change to find what you are looking for. The changelog comes with the version you are using, so it only describes what you actually have.
