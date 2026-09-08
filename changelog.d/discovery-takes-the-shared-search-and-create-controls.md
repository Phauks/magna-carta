---
category: Changed
audience: public
---

**Discovery's three screens take the product's search and create controls, and the search is a real
one.** The register, a review set's document list and its Loads screen each shipped without
`ScreenSearch`; Loads carried a button per act — "New Custodian of Record" beside "New Load" — which
is the shape the standing list-screen ruling names outright, and the register listed corpora with no
way to start one.

**Every one of the three searches on the server, over the whole record.** A field that narrowed the
rows already fetched would have answered about the first page of a cursor-paged listing and read as
the whole of it, which on a corpus a firm certifies the contents of is the most expensive kind of
wrong. So the reads gained the parameter instead: `ReviewDocumentListFilters.search` over
`source_name` and `source_path`, the two review-set listings over `name`, and the loads listing over
`source_description`. Each is a LIKE scan placed AFTER every clause that can use an index — the
review-set predicate, the access predicate and the equality filters — so what it walks is one corpus
the member may see, stopped by the page limit; `likePattern` escapes the reader's own `%` and `_`
once, in one place, so a production whose files are named `100%_final` does not silently match
everything. The cost is stated in the read that pays it rather than hidden behind a control that
looks like the rest.

**On the document list the search is a CRITERION, not a control beside them.** It is a built provider
in `criteria.ts` like every other narrowing, so it rides the address — a searched queue is a link a
supervising attorney can send — it composes with the Custodian, load, family, state and exception
filters as an intersection, and a bulk coding act over the result works unchanged, because what it
holds is a criteria set rather than a page of identifiers. Providers gained `setFrom` for the two
whose control is not the popover (the family, named by opening a document; the search, set in the
action row): they still render there, saying where they are set and offering the way to clear them,
because that popover is the one control answering "why is this list short".

**Keyword stays a separate criterion, and the difference is now legible on screen.** Searching what a
document is CALLED composes into this listing; searching what is INSIDE it composes into the review
set's own index, is still `soon`, and sits next to the name search in the Narrow control so a reader
choosing between them can see which is which.

**Loads' two buttons are one `CreateControl`** reading the bare "New", each choice carrying its own
refusal, and its "Each Load" panels follow the table rather than the read. **The register creates
too**: it shipped read-only on the reasoning that a create control would have to ask which matter
and would therefore be the matter's screen in disguise, which the Conflicts Check ruling settled the
other way a day later — `NewReviewSetDialog` now takes `chooseMatter` and asks, over the caseload,
exactly as the conflicts composer does from its own two doors.

## Public

**Every discovery screen searches now, and it searches the whole record — not just what is on
screen.** The magnifier sits in the row above the table on Discovery, on a review set's Documents and
on its Loads. Type and the list narrows; the X or Escape clears it; "Show Everything" brings back
what a search and a filter were both holding out.

On **Documents** it searches what each document is called — its name and the path it sat at in the
production — across the whole review set, and it combines with whatever you have narrowed to rather
than replacing it. What you searched goes into the address bar with the rest of your narrowing, so a
searched queue is still a link you can send to somebody else on the review set. Searching the words
INSIDE your documents is **Keyword**, in the Narrow control, and it is still waiting on the search
engine; the two sit next to each other so they are never confused, and the search field says which
one it is.

**Loads has one New control instead of two buttons.** New Load and New Custodian of Record are
choices under it, in the same place every other screen keeps the way to make something. If one is not
available to you, it says why rather than disappearing.

**You can start a review set from the Discovery screen.** It asks which matter it belongs to — a
review set always belongs to one, and the matter decides the document limit it carries and the
lifecycle it lives under. Starting one from a matter's own Discovery section works exactly as before
and asks nothing, because there the answer is already known.
