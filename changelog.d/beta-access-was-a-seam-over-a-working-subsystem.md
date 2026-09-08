---
category: Added
audience: public
---

**Beta Access is live, and it needed no new endpoint.** The firm's release channel was always in the session bootstrap — every session resolves it to evaluate the feature flags it carries — and `PUT /api/v1/firm/release-channel` has existed behind `firm:manageReleaseChannel` since release channels landed. The page was two seams over a working subsystem, and its two rows ("release channel" and "beta opt-in") were one fact asked twice. `SessionBootstrap` in apps/web now declares the `channel` and `flags` the contract already returned and nothing read.

**Instant with a consent, not the draft footer.** Entering beta requires an explicit acknowledgement that the firm accepts pre-release behavior on live client data — the route refuses it otherwise — and the shared commit footer's recap is a generic list of staged changes, which is exactly not that. So the one act that needs saying carries its own dialog, and stepping back to stable is immediate, because the server asks nothing to go back and neither should the screen. The asymmetry is the server's and the page mirrors it rather than inventing symmetry.

**A firm on alpha is told and offered nothing.** Alpha is a platform channel a firm can neither enter nor leave from inside the product; the write's vocabulary is the narrower `{stable, beta}`. A switch there would be a control whose only outcome is a 422 for a reason the firm cannot act on.

The channel is re-read from the session after a change rather than taken from the write's own answer: what actually changes the product is the flag set the new channel resolves to, and that arrives with the next bootstrap.

## Public

**Your firm can join the beta programme, and leave it, from Settings · Beta Access.** Beta builds carry work that has passed review and has not yet been released — they run against your real matters, real client money and real documents, not a copy.

Joining asks you to confirm that, and records who did it in the firm's audit log. Leaving takes one switch and asks nothing: what a beta build already recorded stays recorded.
