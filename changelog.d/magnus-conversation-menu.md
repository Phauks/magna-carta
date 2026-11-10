---
category: Added
audience: public
---

**The Magnus conversation's `…` menu, and a link to one conversation.** `conversation-menu.svelte`
replaces the head row's two icons with one menu: Copy Link, Open in New Tab, Rename (the in-place
edit, now without its pencil), Save to a Different Matter (the existing move dialog), Download
Transcript and Delete. The address names the open conversation as `?conversation=<id>`
(`conversation-link.ts`, mirrored with `replaceState`), and arriving with one opens it even when
the rail has not paged to it. The transcript download (`transcript-export.ts`) reads every page and
writes Markdown through `saveToTarget`. Who asked is named by one helper,
`conversation-author.svelte.ts`, shared by the transcript and the download. Tests:
`apps/web/test/magnus-transcript-export.test.ts`.

## Public

Each Magnus conversation has a menu (the three dots beside its name). From it you can copy a link
that opens that conversation directly, open it in a new tab, rename it, save it to a different
matter, download the whole conversation as a file, or delete it.
