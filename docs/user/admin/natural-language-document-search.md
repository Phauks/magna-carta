# Turning on question-and-answer document search

Your firm can turn on a search that lets people ask an ordinary question — _"where did we agree to a
contingency on appeal"_ — and get back the passages of your own documents that best match it. It is
off for every firm until an administrator turns it on, and turning it on is a decision worth reading
this page for first.

This page is for the person making that decision. The guide people use it with is
[Asking a question of a matter's documents](../features/asking-a-question-of-a-matters-documents.md).

## What changes when you turn it on

Today, the text of your firm's documents lives in your firm's own storage and nowhere else, and the
search index over it lives in your firm's own storage and your firm's own database.

Turning this on copies **the extracted text** of your working documents — not the original files —
into a store and a search index that Cloudflare runs and manages. That store is not one this platform
can name, inspect, list, or partition.

Two things people often assume, that are not what is happening:

- **No outside AI company is involved.** The work of matching your question to your text runs on
  Cloudflare's own models, on Cloudflare's own network. Nothing is sent to any third-party model
  provider.
- **Nothing is written for you.** The feature returns passages your own lawyers wrote, with the
  document, version, and page they came from. It never composes an answer, a summary, or a
  recommendation.

But "no third party" is not the same statement as "nothing moved", and that is why this is your
decision rather than a default. Whether your own client agreements permit privileged material to rest
in a managed store is your firm's judgement.

## What the disclosure says, in full

Before the setting can be turned on, an administrator has to accept a written statement. It is
recorded against your firm with a version number, who accepted it, and when. Every point in it is one
your firm can check, and none of it is a promise the platform cannot keep:

- The extracted text of your working documents is copied into Cloudflare-managed storage and a
  Cloudflare-managed search index, outside your firm's own storage and database.
- Embeddings and result ranking are computed by Cloudflare Workers AI. No third-party model provider
  is involved, and nothing is generated.
- A member's typed question is transmitted to Cloudflare so it can be matched against your text.
- The index is not authoritative. Every result is re-checked against your firm's own records before
  anyone sees it.
- **Data residency: the location of the managed index is not one this platform can specify or verify,
  and no guarantee is offered.** A firm with a data-residency obligation should not turn this on.
- **Deletion: when you turn it off, the platform deletes the extracted text it wrote and can show you
  the record of having done so. Deletion of the managed index is a request made to Cloudflare whose
  completeness this platform cannot demonstrate.** A firm that requires provable erasure from every
  store should not turn this on.
- The index is behind — by up to an hour plus the time a sync takes — and every result says how far.
- Cloudflare has this product in open beta, with preview pricing and billing not yet switched on.
  When Cloudflare starts billing, this becomes a metered feature and your firm will be told before
  that happens.
- Whether your own client agreements permit any of this is your firm's judgement.

**Read the two bold points as refusals rather than caveats.** They are the two questions the platform
cannot answer, so it declines to answer them rather than reassuring you.

### When you will be asked again

The acceptance is recorded against a version. If the feature ever changes what it copies, where it
copies to, or what it can do — searching across the whole firm rather than one matter, or generating
text of any kind — the version changes, your firm's acceptance no longer matches, and you are asked to
read and accept the new statement before the feature carries on. You do not have to watch for that;
it happens on its own.

## What is searched, and what never is

Only your firm's **own working documents** — the committed versions of documents on your matters.

Nothing else reaches the index, and that is a matter of how the feature is built rather than a filter
that could be set wrongly. Specifically, none of the following is ever searched:

- **Material an opposing party produced to you.** Discovery review sets are a different kind of
  corpus, and material you received must not surface in a search of your own working files. There is
  no setting for this, because there is no case in which it should be on. If you want search over a
  review set, that is discovery's own feature.
- **Documents somebody has open and has not saved.** Only committed versions.
- Download bundles, format conversions, the original email files behind filed messages, and the
  firm's internal search index files.

## Leaving a matter out

Once your firm has turned the feature on, **every matter is searched**, and a matter carries a switch
to leave it out.

It is deliberately the way round: in, unless you say otherwise. A search that covered only the matters
somebody remembered to tick would have invisible gaps — a lawyer who finds nothing concludes there is
nothing, and is wrong. The escape hatch exists because a matter under a heightened confidentiality
undertaking is a real thing and your firm needs somewhere to put it.

**Leaving a matter out also deletes what has already been copied for it.** It does not merely stop
new documents being added. That is the point: an exclusion that only stopped new writes would leave
the very material that prompted it sitting in the index.

## Turning it off, and what the record shows

Turning the setting off does three things, in this order:

1. Stops anything further being copied — immediately, as part of the same change.
2. Deletes every piece of extracted text the platform wrote, from your firm's own storage, and marks
   each one deleted in a record you can read back. The platform also reconciles that record against
   the storage itself, so a disagreement is reported rather than missed.
3. Asks Cloudflare to delete the managed index, and records exactly what Cloudflare said in reply.

**Step 2 is something the platform can show you. Step 3 is a request.** The confirmation says so in
those terms and does not say "provably deleted", because that is not a claim available here. If your
obligations require provable erasure from every store, this feature is not for you — and the
disclosure says so before you accept it.

## Cost, while it is a beta

Cloudflare has this in open beta with preview pricing and billing not yet enabled, so today it costs
your firm nothing. The platform still counts what it uses, and keeps two kinds of figure apart:

- **Measured**: how many searches were run, and how many bytes of text were copied. The platform makes
  every one of those calls and writes every one of those bytes, so these are exact.
- **Estimated**: the processing volume of copying text in, worked out from the byte count at a stated
  ratio. Cloudflare does not report it, so it is labelled an estimate rather than shown as a meter.

One figure is missing on purpose: **the storage the managed index occupies is not reported per firm,
so it is not counted and not guessed at.** The usage view names it as a gap.

Once a week the platform runs one trivial search against each firm's index. That is not somebody
searching — it is there because an index that goes a month without a request has its updates paused,
and a paused index would quietly start giving stale answers. It is counted like any other search so
your usage figures match what an invoice would say.

## Related

- [Asking a question of a matter's documents](../features/asking-a-question-of-a-matters-documents.md)
  — the guide for people using it
- [A matter's documents](../features/matter-documents.md) — what a committed version is
- [Review sets](../features/review-sets-and-loading.md) — the separate corpus this search never touches
