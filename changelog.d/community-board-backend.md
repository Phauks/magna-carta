---
category: Added
audience: public
---

**The community board's backend.** Control-plane schema for the board (`community_profile`,
`community_post`, `community_vote`, `community_comment`, `community_flag`,
`community_moderation_action`, and the post-number sequence pair), the new `@magna-carta/community`
package holding the taxonomy, the format-only confidentiality detector, the distinct-firm ranking,
the public projections and the statement builders, and a new deployable `apps/community-worker`
serving public reads and member writes. One board, two post kinds: a votable request with a status
pipeline, and a question whose answers are votable instead. Categories are all product areas and
there is deliberately no general one. Real display name by default with an account-level pseudonym
permitted; the firm is written on every authored row for ranking and moderation and is rendered
nowhere; the voter list is never rendered and the distinct-firm count is withheld below five firms.
Removal is remove-first: a one-write author delete that erases the words, a single confidentiality
report from any signed-in reader hiding the subject pending review, and a format-only detector that
never consults a firm's own records. The board is permanently unindexed and a key-value kill switch
takes every write read-only with no deploy. No screens in this change.

The tenancy exception this surface takes to the firm-scoped data-access rule is argued in its own
decision fragment: `docs/decisions/pending/community-board-is-a-named-cross-firm-exception.md`.

## Public

**A place to ask for what the software should do next, and to ask how it works today.** The
community board is open for anyone to read without signing in, and open to write for anyone at a
firm on Magna Carta.

Two kinds of post share the board. A **request** asks the product to change: other firms vote for
it, and it carries a status you can see — Future, Planned, Building Now, Beta, Completed, or Not on
the roadmap, with a stated reason whenever something is declined. A **question** asks how to do
something, and the answers are what get voted on rather than the question.

Every category is a part of the software — trust and reconciliation, billing, discovery, the client
portal, and so on. There is no general category, on purpose: the board is about the product, and a
question that needs a client's details belongs in support, where it stays confidential.

**Your name, never your firm.** Posts are signed with a display name, which starts as your own name
and which you can change to a handle for your account at any time. Your firm is never shown. Vote
totals are shown; who voted is not, ever. The board asks search engines not to index it.

**If something should not have been posted, it comes down first and gets discussed after.** You can
delete your own post or reply in one click, and the words are gone immediately. Anyone signed in can
flag a post that looks like it carries client information, and one flag is enough to hide it while
somebody reviews it. Posts are also checked automatically for things that look like matter numbers,
case captions, contact details and amounts beside names, and anything that trips the check is held
rather than published. The check errs toward holding, and a post held by mistake is released on
review.

File and image attachments are not available on the board. A screenshot of your own workspace
usually carries a client name, a matter number and a balance, so anything that needs one goes to
support instead — and the composer offers that as a one-click alternative.
