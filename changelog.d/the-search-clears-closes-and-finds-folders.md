---
category: Fixed
audience: public
---

**The screen search clears, closes, and goes somewhere.** Four corrections from the owner's first
walk of the matter search, all made in the one shared control so every list screen inherits them.

A live query now carries an **X** at the field's trailing edge. Escape always cleared the field, but
Escape is a key and nothing on screen said so — a person reaching for a pointer had to select the
text and delete it. Both paths now run the same code.

**Clicking away closes an empty search.** It did not before: focus landing on the page's background
was read as focus going nowhere, so the field stayed open behind whatever you did next. A search
with something in it still stays open, because a narrowed list has to carry its reason on screen.

**Enter opens the full results**, flushing whatever you typed last so it never opens a search one
keystroke behind the field.

**The panel opens with the field** rather than with your first keystroke, so the scope and the way
through to the full search are reachable before you have typed anything — including going straight
to the full search page with nothing typed at all.

**A matter search finds folders.** Searching a matter for a folder by name answered nothing while
the folder sat in the tree: the Files source only ever matched file names, and consulted folders
only to say which one a file was in. Folder names are now matched alongside file names, in the same
Files group, each labelled so a folder and a file of the same name are told apart.

**The control opens in two directions, and the downward one is now a seam on the component.** The
icon opens to the inline start into the field (writing the query) and downward into a `panel` snippet
(aiming it, and reading what came back). That panel renders INSIDE ScreenSearch's own root, which is
load-bearing rather than tidy: the collapse watches measure against that root, so a panel rendered
beside the control is read as "outside" and shuts the field on the first click into it. The matter
search's scope moved out of the `scope` seam and into that panel — the seam seats a control inside
the field's leading edge, and "Everything on this matter" spelled out there took most of the field's
width on a header line.

One fitness rule was widened to allow it, deliberately and narrowly: a percentage on a logical
`inset-*` property means "this element's own extent", which `styles/animations.css` already
establishes cannot be a token. Only bare percentages, only on the four inset properties.

## Public

**The search box now clears, closes, and takes you somewhere.**

A search you have typed into carries an **X** at its end. Pressing Escape always emptied the field,
but nothing on screen said so, so there was no way to clear it with the mouse alone.

**Clicking anywhere else now closes an empty search box.** It used to stay open behind whatever you
did next. A search with words still in it stays open, so a narrowed list always shows you why it is
narrowed.

**Pressing Enter opens the full results page**, and you can now open it before typing anything —
useful when you want the whole search surface rather than the quick panel. The panel itself opens as
soon as you click the search, so you can change where it looks before you start typing.

**Searching a matter now finds folders, not just files.** Looking for a folder by name used to come
back with nothing even though the folder was sitting in the matter. Folders now appear under Files
alongside matching documents, each labelled so you can tell a folder from a file of the same name.

**The search opens in two directions.** The icon opens to the left into the field, which is for
writing the query, and downward into a panel, which is for aiming it — the scope, and whether
deleted records join the answer. The scope used to sit inside the field itself, where spelling out
"Everything on this matter" took most of the width the field had.
