---
category: Fixed
audience: public
---

**An office document could not open in the browser editor, and the screen never said it was trying.**

Two defects, found on one real open, that compounded into a blank frame.

coolwsd composes its `frame-ancestors` from the two origins it knows — its own, and the WOPI host it was configured with — which is correct for the ordinary integration, where the WOPI host is also the page doing the framing. It is wrong for this topology by construction: the WOPI host here is `wopi.magna-carta.internal`, a non-routable name the container reaches only through outbound interception, and the page doing the framing is the firm's own app origin, which coolwsd is never told and cannot derive. The policy it sent named the editor origin and an internal host, the browser found the app origin missing, and refused. No document could have opened through this path.

The app origins are now added to that policy by the worker in front of the container (`apps/edit-worker/src/embedding-policy.ts`), not by coolwsd's own configuration. `net.frame_ancestors` is obsolete and ignored from CODE 24.12.4.1 onward, and its replacement `net.content_security_policy` is truncated at the first space when passed through the image's `extra_params` — which a list of origins always contains. Beyond that, who may embed the editor is a fact about this deployment's app domain rather than about the editor image, and nothing in this repository can exercise the container's configuration, where the rewrite is a pure function with tests beside it. The sources coolwsd put there are kept, because the editor frames pages of its own. Widening costs no tenancy: the access token names one version of one file in one firm and is re-verified on every callback, so the framing origin was never the gate.

The waiting state ended at the wrong moment. Opening is two waits — the launch call, which answers at once, and the editor container, which starts on first address — and the screen fell quiet between them, exactly when the long wait began. It now runs until the editor itself reports the document on screen, through the frame message protocol, and states it with Retry when the editor stays silent past a budget that allows for a cold start. For the editor to speak at all the host must tell it where: the launch now carries the origin that asked for it in the signed token, and `CheckFileInfo` returns it as `PostMessageOrigin` — carried rather than configured, because per-firm subdomains mean there is no one app origin a deployment could name.

## Public

Word-processing documents open in the browser editor again. The screen now shows that a document is opening for as long as it takes — a document nobody has opened recently takes a moment longer while its editor starts — and says so plainly, with a way to try again, if the editor does not come up.
