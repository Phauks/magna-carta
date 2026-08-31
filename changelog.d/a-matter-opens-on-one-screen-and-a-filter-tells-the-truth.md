---
category: Changed
audience: internal
---

**A status filter now offers every status the firm can hold, not only the ones present today.** A
filter whose choices come from the loaded rows tells a reader that "Closed" does not exist whenever
nothing is closed — which is a statement about this page of results dressed up as a statement about
the firm. The four columns whose values the firm itself declares — Status, Practice Area, Location and
Responsible Attorney — now seed the whole declared vocabulary in its own order, each with its true
count including zero. "Who is carrying nothing" is a real question and it was unanswerable before.
Client stays derived from rows, because nothing publishes a client directory.

**Opening a matter is one screen that grows instead of squeezing.** It fits its content first and caps
at the viewport second, and when it caps only the body moves — the header and the action bar hold, so
a refusal can never scroll out from under the hand reaching for it. Matter information and people sit
on the left across two tabs; the client and the conflict check stand together on the right, permanently
in view, because they are the same question.

Status replaces the old framing and reads Prospective, Active and Closed.

**Practice area is a dropdown that seeds itself.** The firm's own matter types existed as an API and
nothing ever seeded them, so a new firm met an empty field. Twenty starting areas are offered
alongside whatever the firm has already adopted; choosing one creates the firm's own type in that
moment, editable from then on, and hands it straight to the docket so the column and its filter know
about it at once.

**One correction could not land, and is rendered rather than dropped.** The create operation accepts
only Prospective or Active, so Closed stands in the list disabled, marked, naming exactly what it
waits on. Creating a matter already closed needs the contract widened.

The middle status is stored as `open` and printed as "Active" — a wire code is not a word anybody
reads. The two meet in one file and nowhere else.
