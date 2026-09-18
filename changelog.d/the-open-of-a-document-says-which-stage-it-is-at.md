---
category: Changed
audience: public
---

**Opening a document in the editor names each stage as it happens, and a stall names the stage it stopped at.**

Opening a document is a chain: the editing session is opened, the editor's container starts, the editor page loads, the editor asks the host about the document, fetches its contents, and shows it. The screen showed one sentence for up to ninety seconds and then a failure that could not say which link had broken — and every failure this path has had was in a different link. The wait is now a staged list that advances as each stage completes, with the time elapsed beside it.

The two stages the screen cannot see from the browser — the editor asking the host about the document, and fetching its contents — are the ones that failed most, because they happen inside the container. The host now records each of the editor's calls against the member's open (which call, what it was answered, and the Error ID where it was refused), and the screen reads that record while it waits. So a stall says "the editor came up but never asked the host about the document", or "the host refused the editor's request for the document's contents (answered 404)" with the Error ID, and the failure details list every stage with when it was reached, as one block a member can copy into a report.

## Public

When a document is slow to open, the screen now says which step it is on. If it stops, it says where, with the details support needs.
