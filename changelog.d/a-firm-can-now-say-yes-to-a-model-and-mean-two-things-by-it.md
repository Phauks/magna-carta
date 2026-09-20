---
category: Added
audience: public
---

**The assistant has been reachable since the interface landed, and every firm's copy of it said the
same thing: one of two gates is shut. Nothing could open either one. `magnus.enabled` and
`inference.aiProcessingEligibility` had a reader, a fail-closed resolver and a re-read before the
model call, and no writer but the settings write path — so the honest closed state the surface
renders was also a state a firm could not leave.** Settings · AI and the Assistant is that writer:
`apps/web/src/routes/(app)/settings/ai` over `GET`/`PATCH /api/v1/firm/ai/settings`
(`apps/api-worker/src/routes/firm/firm-ai-settings.ts`), audited on the write.

**Two switches, because they are two questions, and the page refuses to collapse them.** The outer
one asks whether this firm's content may be sent to a third-party model at all; the inner one asks
whether the free-form assistant is one of the things that may send it. A firm that enabled inference
for drafting has not consented to an assistant, and a firm that switches the assistant off has not
withdrawn consent for everything else — `apps/api-worker/src/magnus/consent.ts` has always read both
and failed closed on either, and the screen now asks both in the same shape. It also states the
**effective** answer over the staged values, in a sentence: an assistant switched on above a closed
processing gate does nothing at all, and a screen that showed only "Magnus: On" would be telling an
administrator it works.

**`firm:manageAiSettings`, Owner/Admin alone, and deliberately not `magnus:converse`.** The
conversation key already seeds to Attorney and Paralegal, because asking the assistant a question is
ordinary work. Deciding for the whole firm that privileged client content may leave the platform is
not, and reusing the work key would have let any seat that can ask decide that asking is allowed. The
route test seeds exactly that member and asserts 403 on the read and the write alike — the same
bracket, and the same test shape, that `firm:manageScanPolicy` and `firm:manageReportPolicy` sit in.

**The model is stated and cannot be selected, and that is the design rather than the unfinished part
of it.** Consenting to third-party processing without being told which model receives the content,
what it retains, and whether it trains on it, is consent to nothing legible — so the page reports
`inference.primaryReasoningModel` with its pinned snapshot and both confidentiality facts, as
reported facts in the Versions page's definition-list voice, never as dead controls. The route accepts
no model field. A dropdown would have cost something invisible: an unconfigured firm follows the
platform's reasoning tier and moves forward with it, while a firm holding a model id keeps that choice
forever, so writing an id on the firm's behalf would silently convert "follow the platform" into
"pinned to today's occupant of it". That control wants a setting that can express the tier.

**The seam is asserted, not assumed.** The test that matters is the last one: the two gates this
screen writes are read back through `resolveMagnusFirmGates`, in all three of its states. A settings
screen that wrote keys the resolver did not read would look exactly like a working one and do nothing,
and that failure is invisible from either side alone.

**One shared registry change.** `SettingKind` gains `number` — a bounded integer field for the
assistant's daily question ceiling — and its bounds are **required** rather than optional, checked by
`apps/web/test/settings-mode-purity.test.ts`: a numeric field with no stated ceiling renders as one
that will take anything and be refused by the server, which teaches the wrong thing about what a firm
may choose. `SettingValue` widens to carry a number rather than stringly typing one, so no staging
boundary compares `"500"` against `500`.

## Public

**Your firm can now turn AI on, and decide separately what may use it.** Under Settings, AI and the
Assistant carries two switches. The first says whether your firm's content may be sent to an AI model
at all — nothing is sent to any model while it is off. The second says whether Magnus, the in-app
assistant, is one of the features that may send it, so turning the assistant off leaves the rest
alone. Both are off until you turn them on, and the page tells you in a sentence what will actually
happen once you save.

Beside them the page states which model your content reaches, the exact release behind any answer, and
two guarantees about it: the provider keeps nothing that is sent to it, and never trains on it.

You can also set how many questions your firm may ask the assistant in a day, so the assistant cannot
run up a bill nobody chose. Only owners and administrators can change any of this; everyone else can
see where the firm stands. Every change is recorded, with who made it and when.
