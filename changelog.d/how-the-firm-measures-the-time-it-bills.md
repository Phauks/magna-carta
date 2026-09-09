---
category: Added
audience: public
---

**Billing settings are live, and the local-storage settings registry is now empty.** `GET`/`PATCH /api/v1/firm/time-policy` behind `time:manageSettings` (Owner/Admin by seed) reads and writes the firm's own time-capture policy: the increment a captured duration rounds to, and the direction it rounds in. The rounding engine was always there — the timer, the quick-add preview and every capture already resolve these two keys through the scoped-setting chain — so what was missing was the firm's own door to the firm tier.

**The firm tier, and only the firm tier.** Both keys are scope-overridable: a matter, a client, a timekeeper or a location may carry its own value, and the resolver walks most-specific-first. The route owns one row, so an administrator moving the firm to quarter hours cannot silently reach into a matter somebody deliberately pinned to tenths — and the page says that out loud rather than leaving it to be discovered.

**Not the resolved read.** `GET /api/v1/time-entries/rounding-policy` answers a different question — what will happen to _this_ capture, through the whole scope chain — and rides `time:track`, because every member capturing time needs it. A settings screen needs the firm's own value, the one it is about to overwrite. Collapsing the two would leave a settings page showing a matter's override as though it were the firm's rule.

`time:*` now binds two resources in the conformance map, on the `intake:*` precedent: time entries are matter-rooted, and the firm's capture policy is rooted in no matter at all.

**`SETTING_DEFINITIONS` is empty, and that is the finished state.** Every settings row on the surface now has a server behind it and declares itself beside the draft that reads and writes it. The rule that emptied the registry: a firm setting with a server behind it must not keep a per-browser copy that can disagree with the firm. The mode-purity fitness check was re-pointed at the whole surface rather than that one array, with a non-vacuity guard — a check over an empty registry would have passed by having nothing to check.

## Public

**Settings · Billing now sets how your firm measures the time it bills.** Choose the increment a captured duration rounds to — a tenth of an hour, a quarter, whatever your firm bills at — and whether time between increments rounds to the nearest, always up, or always down.

Time already captured keeps the rounding it was recorded under. The change applies to what is captured after it.

A matter, a client or a timekeeper can carry its own increment, and that one wins over the firm's — so setting the firm's rule here does not disturb a file somebody deliberately set differently.
