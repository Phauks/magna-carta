---
category: Changed
audience: public
---

**Magnus composer: Enter sends, Shift+Enter breaks a line.** `magnus-composer.svelte` sends on a bare Enter and ignores a key pressed during input-method composition (`isComposing`, key code 229). The transcript's message times use `formatInstant` (date and time) instead of `formatTimeOfDay`.

## Public

**Enter sends a question to Magnus.** Shift+Enter starts a new line, and a word still being typed through an input method is never sent early. Each message in a Magnus conversation now shows its date as well as its time.
