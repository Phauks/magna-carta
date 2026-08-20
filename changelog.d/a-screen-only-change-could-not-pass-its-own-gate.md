---
category: Fixed
audience: internal
---

**The scoped gate could not pass a change that touched only screens.** `pnpm check:scoped` handed
every changed path to `vp check`, which runs the formatter and the linter together; the formatter has
no Svelte parser and refuses outright when *every* path in the set is one it cannot format. A change
set of nothing but `.svelte` files therefore failed the gate with "Expected at least one target file"
regardless of what was in it &mdash; and the pre-push hook runs this gate. It stayed hidden because
every screen built so far shipped alongside a route or a transport module, and one formattable path
in the set makes the refusal disappear.

The two passes are now split the way `pnpm fix:scoped` already split them, and for the reason that
script already stated: each pass gets only the paths it can parse. The step construction moved into
its own module so the split is a pure function with a test, rather than something only a real run can
falsify.

**The matter sections kept the previous matter's answer on screen while the next read ran.** Costs,
Time and Parties set their list inside an effect keyed on the matter without clearing it first, so
navigating between two matters left the old table and any old failure standing until the new read
landed. A failure was attributed to the matter now on screen; a list was read as that matter's own.
Each now discards the old answer before asking for the next one.

Parties discards on a change of *matter* only. Its reload after a sever is the same matter's list
being read again, and blanking it there would flash a skeleton over a table the reader is still
looking at.
