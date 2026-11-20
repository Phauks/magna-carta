---
number: 539
slug: translation-runs-on-google-cloud-translation
status: Accepted
date: 2026-11-19
area: Translation
summary: "Translation runs on Google Cloud Translation (the Basic v2 API, keyed by GOOGLE_TRANSLATE_API_KEY from the Secrets Store), chosen by the owner on 2026-11-19. This answers translation design flag T1 the other way from its recommendation, which was the on-platform Workers AI model with third-party translation vendors refused. The firm switch translation.enabled (default off) gates every run on its own, separate from the general AI switch, and the firm's log records each run without its text."
---

**The owner asked on 2026-11-19 to "set up Google Translate translation services", so the engine is
Google Cloud Translation.**

**Context.** The translation design
([`../specs/2026-08-10-translation-services-design.md`](specs/2026-08-10-translation-services-design.md))
left the engine to the owner as flag T1 and recommended the on-platform Workers AI model, with the
dedicated translation vendors (DeepL, Google, Azure) refused because they add a data processor to the
privilege chain. The owner chose Google.

**Decision.**

- **Basic (v2), not Advanced (v3).** Google's authentication page states that every Basic method takes
  an API key and Advanced takes none, so Basic is what fits the platform's Secrets Store keys. Both
  use the same text model at the same price. Advanced's one difference that matters here is a
  regional endpoint; Basic is served globally. Pinning a region later is a second adapter behind the
  same `TranslationPort` (`packages/translation/src/port.ts`).
- **Its own key.** `GOOGLE_TRANSLATE_API_KEY`, restricted to the Cloud Translation API, may live in the
  same Google Cloud project as the Places key, but is a separate key so either can be revoked alone.
- **Its own firm switch.** `translation.enabled`, default off, behind `firm:manageAiSettings`. It does
  not ride `inference.aiProcessingEligibility`, which is about reasoning models under the platform's
  zero-retention catalog; Google's translation service is a different processor on different terms.
- **A record of each run, without the text.** Each translation writes a `translation.translated` row
  to the firm's log: who, when, the engine, the languages, the character count and the matter named.
  The text and the translation are in the response only. This is the recommended answer to flag T4,
  pending the owner's word.

**What Google states about the text** (its Cloud Translation data-usage page, read 2026-11-19): it is
held in memory only while it is translated, is not used to train Google's models, and is not shared
with third parties. **Price** (Google's pricing page, read the same day): the first 500,000 characters
a month are free, applied as a $10 monthly credit, then $20 per million characters, whitespace
included.

**Consequences.** Text a member pastes leaves the platform for Google once the firm turns the switch
on. The member notice and the settings switch say so in plain words. Flags T2, T3, T5, T7 and T8 of the
design are about whole documents and are untouched by this decision.
