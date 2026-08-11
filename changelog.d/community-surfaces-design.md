---
category: Added
---

The design for the **community surfaces** — a public changelog, feature voting, and forums — treated as
three separable things with different audiences, different risks, and different answers. Design and
five decision records only; no product code, no schema, no package.

**The public changelog renders from the source that already exists, once that source can say who it is
for.** Every notable change in this repository is already written as a fragment in plain user-facing
prose, so a second hand-written public changelog would be a second home for the same fact and would
drift within a month. What stops the existing fragments being published as they stand is that a
quarter of them are design documents, at least fourteen say in their own words that they ship no
product code, and one is a build-platform evaluation ending "research only — no configuration
changed." Publishing those would advertise features that do not exist, which breaks the one property
the bundled-changelog model was chosen to guarantee, in the opposite direction from the one it guarded.
So the fragment contract gains a required `audience` key with **no default in either direction** —
defaulting to public publishes a research note the first time someone forgets, and defaulting to
internal means the public changelog quietly stops being written and nobody notices — plus a public
prose block in the same file for entries that are public, and a fitness function that fails the build
on either omission. The eighty-seven existing fragments migrate in one mechanical pass, which is an
hour now and a judgement call per file at eight hundred. Entries publish dated rather than versioned,
because no releases have been cut yet.

**Feature voting moves inside the application, behind the login.** A logged-out board would be a page
full of member content that must never be indexed, an anonymous abuse surface, and a complete public
list of everything customers wish the product did — competitive intelligence given away for an
acquisition benefit that the indexing rule has already removed. Behind a session it has none of those
problems. The public gets a curated three-column roadmap projection instead, with **no date field in
the schema at all** — not nullable, absent, because a nullable date column gets populated by someone in
a moment of optimism and after that it is a promise. Every vote carries the firm that cast it and the
board ranks by **distinct firms** rather than by votes, so a hundred ballots from one firm rank exactly
as high as one; a firm's own client is excluded from the community structurally rather than by a
permission check, since a client appearing in a cross-firm list would disclose the firm-client
relationship, and that failure would be ours rather than the lawyer's. Declining a request becomes a
first-class public act that requires a reason, on a thirty-day triage clock, because the silent
four-year-old post with three hundred votes is worse than a no.

**The forum is recommended against, and the reasons are the interesting part.** A lawyer asking a
practical question can disclose the existence of a matter, a client relationship, or a dispute, and the
duty attaches to far more than privileged content. ABA Formal Opinion 511R holds that a lawyer may not
post about a representation to a listserv **even hypothetically** where a reader could infer the client
or the situation, then or later — and it says that about closed, membership-verified lists, so a
public, indexed, permanent forum is the same hazard with an unbounded audience. The test is about the
client rather than the lawyer, so a pseudonym mitigates and does not cure, and presenting one as a safe
harbour would be worse than offering nothing because it invites the post that would not otherwise have
been made. Beneath that, the demand splits in two and neither half is forum-shaped: product questions
have one correct answer and belong in a knowledge base, and practice questions are already served by
bar-association listservs that verify membership and bound the audience, which we cannot do and have no
standing to replace. The venue that is actually safe already exists and is called support — the
platform is already the firm's data processor, so a lawyer can tell us what they cannot tell the
internet. The dormant discussion seam stays dormant, and waking it is a decision to be re-taken against
three named conditions rather than inherited.

Also settled: what the platform does at 3am, which is that it **degrades rather than moderates** — a
read-only kill switch in KV, one operator write and no deploy, built with the first write endpoint
rather than retrofitted across every route during the incident that needed it; first-post
pre-moderation so nothing from a brand-new account is publicly visible before a human sees it; and
removal treated as the real protection rather than warnings, which means a post body has exactly one
home, notification emails link and never quote, member content is never indexed, and edit history is
never public. A confidentiality modal on every post is rejected as patronising and legally worthless; a
single first-post notice that cites the opinion by name and states the actual test is not. A table of
twelve decisions that are cheap today and impossible or painful later closes the spec, and one question
is left open for the owner: whether the public changelog lives on the marketing domain or beside the
status page on the product domain, which the owner's description and the white paper's hosts table
currently answer differently.
