---
slug: caller-id-is-a-paid-lookup-a-member-presses-for
status: Accepted
area: Communications
date: 2026-11-09
summary: "A typed number in the call record is matched to the Directory and placed by its area code for free, and its caller ID name is a Telnyx Number Lookup that runs only when a member presses for it. The answer is kept per firm in caller_identity so one number is paid for once. Only the number is sent to Telnyx. The lookup is dormant until TELNYX_API_KEY is set. Call recording is out, by the owner's ruling, so nothing here touches audio."
---

**A caller ID is a paid lookup a member presses for, and its answer is kept.**

**Context:** the owner asked on 2026-11-09 for caller information the moment a number is known. The
firm's phone service (a cable carrier's business voice line) exposes no API or webhook, so the number
arrives by being typed. Caller-name data is sold per query by the carriers' CNAM databases; there is
no free source for it. The owner asked whether a free version existed and, on hearing there was none,
asked for the lookup to be built.

**Decision.** Three answers, cheapest first. The Directory match and the area code's region are free
and shown as soon as the typed number is valid. The caller-name and carrier query goes to Telnyx
Number Lookup — the vendor the white paper already names for voice and messaging — only when a member
presses **Look Up Caller ID**, and the answer is stored in the per-firm `caller_identity` table keyed by
the number, so the same number is never paid for twice at one firm. The enhanced and caller-identity
query types are not used; they cost several times as much and a member deciding to pay is the right
place for that choice if it is ever wanted.

**What leaves the platform** is the number alone: no name, matter or firm. That disclosure is the one
the owner accepted by asking for the lookup.

**Dormant until provisioned.** With `TELNYX_API_KEY` absent the free answers still arrive and no
button is shown. It is not a required secret, for the reason the Turnstile key is not.

**Consequences.** A kept answer can go stale when a number changes hands; a member can be offered a
refresh later if that proves to matter. The `caller_identity` row is personal data reached by number,
hard-deleted on erasure. The call-and-text log design's statement that Nevada is a one-party-consent
state is wrong — Nevada requires all-party consent for recording a telephone call (NRS 200.620; see
https://www.rcfp.org/reporters-recording-guide/nevada/) — and the owner has ruled call recording out
regardless.
