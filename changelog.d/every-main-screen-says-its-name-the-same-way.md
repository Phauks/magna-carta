---
category: Changed
audience: public
---

**Every main screen states its name the same way, and the sidebar agrees with it.** The screens had
drifted into four ways of introducing themselves: Home greeted the reader with the time of day,
Notifications titled itself "Notification Center" while the sidebar row opening it said
Notifications, Downloads and Notifications each carried an eyebrow repeating their own title back,
and Conflicts Check, Tools, WHOIS Lookup and Assemble a document each carried a sentence under the
title restating what the title said. Matters, Directory and Custodian carried a title and nothing
else, because the ruling that got them there reached the list screens in 2026-08 and stopped.

Every main screen now takes the Matters shape — `ScreenHeader` with the destination's own name from
`navigation/destinations.ts`, no `eyebrow`, no descriptive `meta`. The rule is not new ("a heading
carries no explanatory sub-text"); it had only ever bound lists, and now binds every archetype,
recorded under a new "Screen headers" heading in
[`docs/conventions/design-corrections.md`](../docs/conventions/design-corrections.md) and restated
on `screen-header.svelte` itself so the next author meets it at the call site. A meta line still
carries facts — Home's date, a room's kind and seat count, the speed test's run time, Assemble a
document's alpha badge — because the test is unchanged: removing the line must lose a fact.

**The `my-work` destination becomes `tasks`.** A matter's own section was already Tasks, so the
registry and the matter used two names for one noun. That screen also had no page heading at all —
its name was a `FieldLabel as="h2"` inside `TaskList`, so the route rendered no `h1` — and it now
carries a real `ScreenHeader`. `TaskList`'s `heading` turns optional for exactly that reason: a
matter's Tasks section still names itself, because the matter's masthead carries the matter's name,
while the firm-wide list lets the page's own header speak. `mergeGroupOrder` skips stored ids it no
longer knows, so a member who had dragged the old row to a custom sidebar position finds Tasks at
its canonical position and keeps the rest of their arrangement.

**What a header gives up, the page takes back.** Neither line that carried a real fact was deleted;
each moved to where the fact is used. The safe website viewer's isolation notice now renders in
`WebsiteShell`'s new `note` band, at the address bar beside the control it qualifies, yielding to
`invalidHint` because a fault with the address in hand outranks a standing fact. The seventeen
settings pages give up their masthead descriptor the same way: `SettingsMasthead` no longer takes a
`meta`, and the sentence renders through `settings-description.svelte` as the first line of the
page's own scroll area, so it travels with the plates it describes. `SettingsPage` still takes
`meta` and passes it there, so a standard settings page is unchanged at its call site.

The `tasks.my-work-*` load-profile measurement names are left alone — recorded measurements, not
user-facing text.

## Public

**Every main screen now says its name the same way.** Each one is headed by exactly the name you
clicked in the sidebar, with nothing above or below it — the way Matters always looked. Home is now
Home rather than "Good morning", and the Notifications screen is titled Notifications rather than
"Notification Center". The one-line descriptions under a handful of titles are gone; they repeated
what the title already said and cost a working screen a row of space. Lines that tell you something
real stay put, like the date on Home and the seats in a room.

**My Work is now called Tasks**, matching the Tasks section inside a matter — one name for one
thing. It works exactly as before. If you had dragged My Work to a particular spot in your sidebar,
Tasks will be back at its default position; everything else you arranged stays as you left it.

**Nothing worth knowing was lost.** Where a line under a title told you something real, it moved to
where it matters rather than disappearing. The safe website viewer's reminder that a page opens in
an isolated browser and never loads in yours now sits at the address bar, next to where you type.
Each settings page still opens with the line describing what it governs — it just reads as the first
line of the page now, above the settings themselves, instead of in the header band.
