---
number: 436
slug: a-directory-record-is-one-window-wherever-it-opens
status: Accepted
date: 2026-09-05
area: Directory
summary: "A person or an organization in the directory has one surface, the entity window, and no screen of its own. The window takes the New Person screen's shape — the record's sections as a rail on the left, the chosen section's pane beside it, what stands about the record on the right — and opens over whatever the reader was doing: the directory's list, a matter's parties, the client fact on the overview, a conflicts hit. Closing it lands the reader back where they were, so no way back is owed, and the header's way back on every remaining screen keeps meaning the screen above. The record's address is the directory's, carrying which record to open, so a pasted link still lands on it; the old record route redirects there. A related record opened from inside the window swaps its subject; a record opened from another window stacks once. A host contributes only what it alone knows — a matter, the roles the record holds on it — and never describes the record itself. Chosen over an origin-aware way back and over a breadcrumb trail."
---

**A directory record is one window, wherever it opens — and it has no screen.**

**Context:** Every screen states where it was entered from by naming a sidebar destination, and the
gate behind that (`lint:back-navigation`) holds every screen under a screen to it. The model assumes
a screen is only ever entered from the screen above it or from the sidebar. One path broke the
assumption: a party on a matter's parties tab opened the person as a screen in the directory, whose
way back led to the directory's list rather than to the matter the reader had just left. Three
remedies were weighed. An origin-aware way back would remember the screen a reader came from, which
with the browser's own back button out of bounds becomes a stack, and a stack is a trail somebody
has to keep track of. A breadcrumb trail asserts that a person sits under a matter, which is not
so. A window over the matter keeps the reader where they are.

**Decision:** The window, and only the window. A directory record opens in the entity window
(`apps/web/src/lib/directory/entity-window.svelte`), on the action dialog's reading kind at record
width, in the arrangement the owner chose for creating a person: the record's sections as a rail on
the left, the chosen section's pane beside it, and on the right what stands about the record as a
whole. The panes are the components the record screen composed; the screen itself is deleted. Every
host opens the window in place — the directory's list, a matter's parties, the client fact on the
overview, the conflicts hit window — and none of them describes the record; a host hands over only
what it alone knows, which for a matter is the roles the record holds on it. A related record
opened from inside the window replaces its subject rather than raising a second window; a record
opened from another window stacks one level and no more.

The address of a record is the directory's, carrying which record to open (`/directory?record=`),
so a link pasted into a message still lands on the record with the book beneath it. The directory
host opens the window from its address, mirrors a swapped subject back into the address in place,
and takes the record out of the address on close. A matter host leaves the matter's address alone.
The former record route redirects, and the back-navigation gate carries it as its one stated
exemption.

**Consequences:** No way back is owed by a record, and the registry model of the way back holds
everywhere again. The record has one shape from every entry point, which is what makes it cheap to
offer from a new one. The window's context pane is where a host's knowledge goes, so a second host
with something of its own to say adds lines there and nothing to the record. A person cannot be
opened beside the reader's work with a modifier key from a party row any more, since a name that
opens a window is a control rather than a link; the address remains for that. The Record Detail
archetype now names only the matter.
