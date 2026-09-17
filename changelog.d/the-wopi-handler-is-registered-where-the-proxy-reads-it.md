---
category: Fixed
audience: public
---

**The editor's container was refusing its own WOPI callback, because the handler for it was declared where the runtime could see it and not where the proxy reads it.**

With the frame allowed, the socket connected and the host trusted, coolwsd's first call to the WOPI host — `CheckFileInfo`, the call that decides whether a document opens at all — came back 520, and the container log named it: `WOPI::CheckFileInfo returned 520 (Unknown) Server Error`, then `CheckFileInfo failed … State::Fail`, and the editing session was dropped. 520 is `@cloudflare/containers`' own "Origin is disallowed" answer, the one it gives a host it intercepted but found no handler for.

The handler was there. `DocumentEditorContainer` declared it as `static outboundByHost = { … }`, the shape the library's README shows. But `Container` declares `outboundByHost` as a static accessor pair whose setter files the handlers in a module-level registry keyed by class name, and that registry is what `ContainerProxy` reads when the intercepted request arrives. Under the class-field semantics this repository compiles to (ES2022), a static field is a definition, not an assignment: it creates an own property on the subclass that shadows the inherited setter, which never runs. The two halves of the library then disagreed. The half that decides which hosts to intercept reads the property, so the WOPI host was intercepted; the half that dispatches reads the registry, found nothing, and refused.

The handler is now registered by assignment in a static block, which reaches the inherited setter. The proof runs the library's real dispatch: `test/document-editor-container.test.ts` builds the `ContainerProxy` the runtime would build for this class and sends it coolwsd's callback, which now reaches the app worker, while every other host is still refused. Against the shipped class the same test answers 520 — the production failure, reproduced. To run it, the edit worker's suite inlines the library and answers `cloudflare:workers` with a two-class stub; the Container class had been kept out of the suite until now, and this is the one test that needs it.

## Public

Word-processing documents open in the browser editor. The editor could reach everything it needed except the document itself; it reaches that now.
