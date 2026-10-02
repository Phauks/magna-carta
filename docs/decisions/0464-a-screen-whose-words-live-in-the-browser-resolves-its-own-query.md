---
number: 464
slug: a-screen-whose-words-live-in-the-browser-resolves-its-own-query
status: Proposed
date: 2026-09-14
area: Web / Notifications / Conflicts / Magnus / Calendar
summary: "Every shipped Workspace screen searches through the one ScreenSearch control in its header's action row, or records why it does not, enforced by a new fitness function (`pnpm run lint:workspace-search`) that also refuses a second implementation of a search box and a decline left standing after its screen gained a search. Three hand-rolled search boxes (the Matters docket, the Directory, a matter's Notes) are replaced. Where a screen's rows are paged off the server, the query goes to the server rather than narrowing the page in hand — narrowing what happens to be in the browser answers 'of the forty I have read, which match' while appearing to answer 'which of yours match'. Two of those screens carry no sentence in the record at all (a notification row holds identifiers, closed labels, counts and dates; the conflicts log holds closed labels and identifiers recorded by reference), so the CLIENT resolves the term into the kinds and categories whose displayed words match and sends those with it, and the server ORs them against the one member-facing string the row carries. Magnus searches transcript content only for a member's own conversations, never on the firm-wide administrative read, because transcripts may not be swept across the firm's records until the discovery surface owns an include-or-exclude control. The Calendar narrows the window on screen and says so, because its three reads cap their horizon server-side and refuse a wider one. `@magna-carta/data-access/like-search` becomes the one home for escaping a reader's text into a LIKE pattern."
---

**A screen whose words are composed in the browser resolves its own query; the server still does the
paging.**

**Context.** `ScreenSearch` shipped as the product's one control for searching within a screen,
carrying the debounce, the clear glyph, Escape, and the collapse-on-click-away — and the argument for
it, written in its own header, is that eleven hand-rolled search boxes improve one at a time and drift
in between. Three screens were nonetheless still carrying their own when this was checked: the Matters
docket, the Directory, and a matter's Notes, each a `type="search"` field beside a Lucide glyph with
its own debounce and its own idea of what pressing the icon on a live query should do. The two
corrections issued against the control on 2026-09-02 — the clear glyph, and clicking outside an empty
field closing it — had reached the component and none of the three. That is the ordinary cost of a
duplicated surface: the fix lands where somebody remembered to look.

Four further screens had no search at all, and the first pass at this work recorded them as declining
on the grounds that their rows are paged off a read taking no search parameter. The owner's
correction: that is a reason to add the query, not to skip the search.

**What made it more than plumbing.** Two of the four hold no text to scan.

A notification row carries identifiers, closed labels, counts and dates, deliberately — a stored
sentence would outlive the access check that justified writing the row and would go stale invisibly
when the matter behind it was renumbered. The words a member reads ("Deadline overdue") are composed
client-side from the kind and the declared facts. A conflicts check row is the same shape for a
different reason: its trigger and strictness are closed labels the register already narrows by from
its column filters, and `inputs_json` records identifiers by reference and never a plaintext name.

So a substring scan server-side would be searching `deadlines.deadline.overdue`, which is not what
anybody types.

**Decision.** The half that owns the words resolves the query; the half that owns the rows pages them.

For Notifications the client matches the term against its own `KIND_PRESENTATION` titles and category
nouns (`kindsMatching` / `categoriesMatching`) and sends the resulting kinds and categories with the
raw term; the read ORs `kind IN (…)`, `category IN (…)` and the matter number. An empty kind list
means the term matched no kind — never "match no row", which is the distinction that decides whether
searching a matter number works at all. The unread badge is deliberately not narrowed: it counts what
is waiting for a member, which is a fact about their work rather than about the box they last typed
in.

For Conflicts Check the search answers the two questions the column filters cannot — which matter a
run was made against, and whose name it surfaced — reaching names through the directory's stored
`normalized_display` so the term normalizes the way the corpus did.

Three further rulings ride with it:

- **Magnus searches what was said, and only a member's own.** Titles alone would be close to useless
  there, since nothing generates one. Content is in scope exactly when the read is scoped to a
  member; the firm-wide administrative read matches titles only, because `packages/magnus/CLAUDE.md`
  holds that transcripts are discoverable material that no surface may sweep across the firm's
  records until the discovery surface owns an explicit include-or-exclude control. `searchesContent`
  is the single place that boundary is decided, and it is asserted against the composed SQL rather
  than the helper alone.
- **The Calendar narrows the window on screen and states that it did.** Each of its three reads caps
  its horizon server-side and REFUSES a wider one rather than clamping it, so "search the whole
  record" is not a request that can be made there yet. That is allowed to be the answer and is not
  allowed to be silent: the view reports how many entries in the named window match and that other
  dates were not searched. A bare "3 matches" beside a month grid would read as three on the
  calendar.
- **Home declines**, being a summary of other screens rather than a list of its own; the query it
  would answer is the command palette's, already in its top bar.

**The gate.** `pnpm run lint:workspace-search` reads the Workspace group out of the sidebar registry
and the pages out of the route tree, so no roster is kept by hand, and refuses four things: a
Workspace screen that neither searches nor records a decline, a control seated outside the header's
`actions` snippet, a decline left standing after its screen gained a search, and a second
implementation of a search box anywhere beneath a Workspace destination. Coverage follows the render
rather than the file — it walks each page's `$lib` component imports — so a screen that keeps its
search in the component owning the list passes on the search that actually works. Membership in the
repo-wide lint set is derived from the `lint:*` scripts, so registering it put it in the inner loop
and the gate of record at once.

**One home for the escape rule.** Two copies of "escape a reader's text into a LIKE pattern" already
existed (the discovery review reads and the communications log), agreeing by luck rather than by
construction, and a third was about to be written. `@magna-carta/data-access/like-search` is now the
one home. A test written against it caught the bug that makes it worth having: `normalizeName("%")`
strips punctuation to the empty string, and a contains-pattern built from an empty term is `%%`,
which every stored name matches — so a reader typing one stray character into the conflicts log would
have been handed every check the firm has ever run, presented as though each had surfaced their
query.

**Considered and rejected.** Narrowing the rows already in the browser on a paged list: it answers a
different question from the one asked, and answers it silently. Storing a rendered sentence on the
notification row so it could be scanned server-side: that is exactly what the subsystem's redaction
boundary refuses, and it would go stale behind a renumbered matter. Widening the calendar's read
horizon to cover all time: the cap is deliberate and lives on three separate reads, so spanning them
is its own piece of work rather than a side effect of adding a search box.
