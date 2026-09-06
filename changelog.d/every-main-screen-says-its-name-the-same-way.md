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

Two exclusions are deliberate and recorded with the rule. `settings-masthead.svelte` makes its
descriptor a required prop by an earlier owner direction, so the seventeen settings pages were not
touched. The safe website viewer keeps its line: "the page renders in an isolated remote browser" is
a consequence a reader needs before pressing, which the rule protects. The `tasks.my-work-*`
load-profile measurement names are left alone — recorded measurements, not user-facing text.

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
