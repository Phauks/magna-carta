---
category: Fixed
audience: public
---

**The browser editor loaded its shell and never its document, because the worker in front of it rebuilt the WebSocket upgrade.**

The editing session rides a WebSocket. `allowAppFraming` added the app origins to the Content-Security-Policy on the way out of the container, and it decided whether a response needed that by looking at the policy header first — so a response carrying one was rebuilt with `new Response(body, { status, headers })`. For the upgrade, that is fatal twice over: the runtime refuses to construct a response with status 101 at all, so the handler throws and the handshake dies, and a reconstruction drops the `webSocket` the upgrade carries even where it would not throw. The editor's own page and assets are ordinary HTTP and loaded fine, which is why the shell drew and the document never arrived.

The upgrade is now handed back untouched, and that is checked BEFORE the policy header rather than after. The ordering is the fix: the previous arrangement was correct only while coolwsd never set a security header on its own upgrade, which is an assumption about somebody else's server that a version bump is free to falsify — and the cost of it being wrong is every editing session in the product rather than one stray header.

## Public

Word-processing documents now open all the way. The editor's own frame was arriving without the connection that carries the document, so it drew an empty toolbar and stopped.
