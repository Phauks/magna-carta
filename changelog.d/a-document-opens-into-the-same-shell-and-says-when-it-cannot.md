---
category: Fixed
audience: internal
---

A word-processing document opened to a white rectangle, with nothing in the console to say why.

The editor serves correctly and always did. What refused was the browser: coolwsd composes its own `frame-ancestors` and allows only itself and the WOPI host to frame it, and the application is deliberately neither — it is served from a separate registrable domain so the editor never receives an app session cookie. A `frame-ancestors` refusal is reported in the FRAMED document's console, not the embedding page's, so the page that opened it saw no error, no event and no clue. The app origins are now named in `containers/collabora/Dockerfile`, written into `coolwsd.xml` at image build time — they cannot ride `extra_params`, whose value the image's entrypoint word-splits, and a list of origins is spaces by definition. The edit fails the image build rather than matching nothing, which is the failure mode that produced this.

The screen can no longer fail this way in silence. The launch was being treated as the opening, and it is not: the launch is our own worker minting a token in a fraction of a second, while the member is waiting on a per-document container that cold-starts in about twenty seconds. So the loading state ended almost immediately and left an empty frame standing for twenty seconds on a good day and forever on a bad one, with no way to tell the two apart. The editor is now handed a `PostMessageOrigin` and announces itself — `Frame_Ready`, answered with the host half of the handshake, then `Document_Loaded` — so the wait ends where the member's wait ends, and silence past the deadline is stated, with the editor's address, Try Again and Download.

Every opened file now wears the same shell. `/documents/[id]/view` and `/documents/[id]/edit` had each assembled their own header, meta line and failure branch, and had drifted; both also rendered the header INSIDE the branch that required a resolved file, so a document that could not be resolved produced a tab with no title, no way back, and in one path nothing at all. One `DocumentShell` now draws unconditionally and the interior is the only thing that differs by file type.

A document opens in its own tab, so that tab is the App Shell without its destination rail: a rail of somewhere-else beside one open document only offers to navigate away from the single thing the tab is for. The top bar stays — search, the trays and the profile are about the session rather than about where you are — and the way back that does make sense, to the matter the document belongs to, is in the document's own header.
