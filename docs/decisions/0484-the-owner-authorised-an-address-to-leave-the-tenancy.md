---
number: 484
slug: the-owner-authorised-an-address-to-leave-the-tenancy
status: Accepted
date: 2026-09-20
area: Directory
summary: "The owner was asked directly whether a client's address may leave the firm's tenancy for a third-party service, and answered that anything may leave. That closes the question the earlier decision left open and reverses its operative conclusion: a provider is no longer refused on disclosure grounds, and the remaining axes are cost, coverage and what a provider actually buys. What this does NOT do is authorise any particular provider, any particular volume, or a call on any particular path — a grant that an address MAY leave is not an instruction that every address SHOULD, and the narrowest call that buys the thing is still the right one. The self-hosted index stops being the only acceptable Layer 2 engine and becomes one option among several, now competing on build cost rather than on privacy. Skip tracing and change-of-address lookup were raised in the same breath and explicitly NOT decided: the owner asked to look into their real-world application first, and the answer turns out to be regulatory rather than technical."
---

**The owner authorised an address to leave the tenancy.**

**Context:** the earlier decision on this — that an address provider is a privacy decision, so the seam
ships before the provider — ended in a question rather than a conclusion, and was filed as
_Proposed — owner decision required_. Its reasoning was that a client's home address is confidential
information the firm holds in trust, that sending it to a third party is a disclosure, and that the
Workers runtime makes such a disclosure so easy to add incidentally that it had to be made
deliberately instead. The question was put to the owner directly on 2026-09-20, with the disclosure,
the cost and the alternatives stated. The answer was that anything may leave.

**Decision: the disclosure is authorised.** A third-party address service may receive a client's
address. The earlier decision's analysis stands as written; its operative conclusion — adopt nothing
yet — does not, and this supersedes it.

**What this authorises, and what it does not.** The grant is that an address MAY leave. It is not an
instruction that every address SHOULD, and the difference is the whole of the design that follows:

- **It does not select a provider.** Which one, at what rate, under whose terms, and what that
  provider may retain are separate questions with different answers per provider.
- **It does not authorise a call on every path.** A validate-on-commit call sends one saved address;
  a type-ahead sends partial text for every address anybody types, including the ones abandoned
  halfway. Both are now permitted and they are not the same act.
- **It does not lower the bar on what is sent.** The narrowest request that buys the thing is still
  the right one, and an address sent to answer a question nobody asked is a disclosure with nothing
  on the other side of it.

**What changes for the lookup engine.** The self-hosted index over open address corpora was
recommended partly because it kept every address inside the tenancy, and that advantage is now worth
nothing. It keeps two real ones — no per-lookup fee, and no dependency on a third party staying up —
and it keeps its costs: an index build, a data-refresh cadence, and a container. A hosted provider is
now a legitimate competitor on those terms, and the choice is an ordinary engineering trade rather
than a confidentiality one. `AddressLookupPort` was built to be indifferent to which side wins, which
is the property that makes this cheap to decide later rather than now.

**What was explicitly not decided.** Change-of-address lookup and skip tracing were raised in the
same answer, with the owner noting they sound useful but that their real-world application needs
looking into. They are therefore **not** authorised by this decision, and the thing worth recording
is why the looking-into matters: the constraint on both is regulatory, not technical. Access is gated
by permissible purpose under the driver-privacy, financial-privacy and consumer-reporting statutes;
it is the FIRM that gets credentialed by the provider rather than the platform; and a compliant
search documents the matter and the proceeding it was run for. That makes a skip trace a recorded act
against a matter — nearer a conflicts check than a form field — and a platform that offered it as a
button beside an address would have built the wrong shape. The existing candidate node for public
records and people search is where that work belongs.

_Settled the same day:_ the owner's answer to the looking-into was to leave both alone until a user
asks for them. That confirms the research note's existing verdict rather than changing it — it had
already deprioritized this category on the ground that the right to pull the data attaches to the end
user, so a platform cannot lawfully resell the lookups from one account, which is structural rather
than a coverage gap. Nothing is built, and the capability node carries the ruling.

**Consequences:** the address roadmap is unblocked on its hardest axis. Deliverability verification
becomes available, which is the half that earns a fee, and the verification columns on the address
row are already where a provider's answer lands, so adopting one remains a writer of four existing
columns rather than a migration. The cost of the grant is that the firm now has a decision to make
per provider about retention and terms, and an outbound call on a request path is a thing that can
fail — the owner's standing ruling that a failed verification notifies and never blocks is what keeps
that from becoming a refusal.
