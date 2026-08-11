---
category: Added
---

The design for the **community surfaces** — a public changelog, feature voting, and a community board —
modelled on ClickUp at the owner's direction and studied against ClickUp's live surfaces rather than
from memory. Design and five decision records only; no product code, no schema, no package.

**The public changelog renders from the source that already exists, once that source can say who it is
for.** Every notable change here is already written as a fragment in plain user-facing prose, so a
second hand-written public changelog would be a second home for the same fact and would drift within a
month. What stops the fragments being published as they stand is that a quarter of them are design
documents, at least fourteen say in their own words that they ship no product code, and one is a
build-platform evaluation ending "research only — no configuration changed." Publishing those would
advertise features that do not exist, breaking the one property the bundled-changelog model was chosen
to guarantee, in the opposite direction from the one it guarded. So the fragment contract gains a
required `audience` key with **no default in either direction** — public publishes a research note the
first time someone forgets, and internal fails silently and the changelog quietly dies — plus a public
prose block in the same file, and a fitness function that fails the build on either omission. The
eighty-seven existing fragments migrate in one pass, an hour now and a per-file judgement call at eight
hundred. Entries publish dated and curated into thematic roll-ups, two-level as ClickUp does, with
likes and a feed — but self-hosted rather than on Canny, category-filterable rather than carrying a
single label, free of the emoji prefixes ClickUp uses, and **linking back to the request that asked for
each shipped item, which ClickUp does not do**.

**The forum question resolved in an unexpected direction: ClickUp does not have one.** Its community
page lists a Facebook group, a subreddit and a university; users asked for a real forum in 2018 and
again in 2023, and the second request was closed "Not on the roadmap" in August 2025 after staff pointed
to Facebook — the poster objecting that those are "social media walls you have to scroll through rather
than an organised searchable forum with different boards." What ClickUp runs under the word forum is a
category-structured, status-tracked, publicly readable board with comment threads that stay alive for
years. That shape sits outside the confidentiality analysis that made an earlier draft of this design
recommend against a forum, because the subject is the software rather than a representation — so the
design builds it, as **one board with two post kinds**: votable requests with a status pipeline, and
threaded questions with votable answers, where a question that turns out to be a missing capability
converts to a request in one action and carries its thread. **The scoping is held by structure rather
than by rules:** every category is a product area and there is no general category, no off-topic, no
practice-management and no ask-a-lawyer, so a question seeking legal advice has nowhere to go and the
composer asks which part of the software this is about before accepting a word. Three failure modes are
named rather than absorbed — the question that is bivalent depending on whether the facts come with it,
the long tail of specificity that no rule separates, and **screenshots, which is the serious one**,
because a screen capture of legal software carries a client name, a matter number and a ledger balance
and defeats every text-based control at once. Attachments are therefore off at launch, with a "send this
to support instead" control taking their place.

**Identity moved toward ClickUp's and away from an earlier recommendation of forced pseudonymity:** real
display names by default with an account-level pseudonym permitted, because with the subject scoped to
software a name discloses nothing, and because the firm — never displayed, here or on ClickUp — was
always the sharper edge, since firm plus practice area plus question is the inference path. The board is
public to read and login-to-write as ClickUp's is, but **never indexed and with the voter list never
rendered**, because ClickUp's public voter list of real names was located through a web search, which is
the harm demonstrated rather than theorised. Votes carry the firm that cast them and the board ranks by
**distinct firms**, so a hundred ballots from one firm rank as high as one. ClickUp's six statuses are
adopted, with a mandatory reasoned decline and a thirty-day triage clock added — ClickUp's own board
demonstrates both failures, a 2018 request marked Completed for something never built and a 2022 thread
still accumulating comments in 2026.

Also settled: two moderation postures rather than one, because the failures are not alike. Spam
**degrades** — a read-only kill switch in KV, one operator write and no deploy, built with the first
write endpoint rather than retrofitted during the incident that needed it. Confidentiality **removes
first and asks later**, inverting normal moderation because a false positive costs a lawyer an
eight-hour wait and a false negative is permanent: one-click instant author delete, a single reader flag
that hides a post, and a format-only detector that never touches firm data because doing so would cross
the boundary the package isolation exists to hold. So at 3am the post is already hidden, and a human
decides at 9am. Fourteen decisions that are cheap today and impossible later close the spec, and one
question stays open for the owner: whether these live on the marketing domain or beside the status page
on the product domain.
