---
category: Changed
audience: public
---

**Registration asked a stranger to classify themselves before anything about them existed.** The
front door opened on a three-way fork — a client of a law firm, somebody who works at one, somebody
founding one — and two of those three led to the same place, because membership of an existing firm
is that firm's decision and never a visitor's. Only the third created anything. So the first question
the platform ever asked was a question about a **relationship**, put to somebody who was not yet a
party to one, on the one screen whose whole job is to establish who they are.

**Joining is now two acts in the order they actually happen.** `/register` makes a person — a name,
an address, the two acknowledgements, one confirmation email, and no fork. Confirming that email
creates the account and sends the link that sets its password. Signing in lands on `/welcome`, a
dedicated in-app screen that settles what the account IS: start a law firm, or redeem an invitation
into one that already exists.

**The account that belongs to no firm is now a real state rather than an unrepresentable one.**
`user.firm_id` was `NOT NULL`, so a signed-in person with no firm could not exist; it is now nullable,
by a reviewed control-plane table rebuild (the tag is in `REVIEWED_REBUILDS`, and the migration's own
`-- contract:` header audits the copy). That nullability is what makes the state fail **closed**:
`RouteMeta` gains `firmlessSession`, defaulting to `reject`, so a session carrying no firm gets the
same reserved 404 a cross-firm request gets on every one of the platform's routes except three. The
bootstrap (`GET /api/v1/me`) declares `allow` and answers a null firm plus what to do next; the two
onboarding mutations declare `only`, which makes them unreachable for anybody who already has a firm
— and that is what lets them carry `permission: null` honestly, since a principal with no firm holds
no capability in any firm to name.

**`disableSignUp` does not change, and this is the part worth being precise about.** Better Auth's
signup route stays refused; the account is created by our own confirmation handler, exactly as
invitation redemption already creates one. The reflow is a **restructuring of the existing
registration and confirmation machinery**, not a new public signup endpoint: same route, same
chokepoint, same tightest rate-limit bucket, same dormant Turnstile gate, same identical answer for a
taken address and a free one. What moves is only what a confirmed token buys — and it moves in the
safe direction. It used to buy a firm, an R2 bucket, a minted key and a second email; it now buys one
`user` row and one email. Firm provisioning moved **behind** an authenticated act by a proven mailbox.

**Invitations keep working in both orders, and the possession proof survives both.** Somebody who
arrives with a code and no account still redeems it anonymously at `/register/invitation`, unchanged.
Somebody who makes an account first redeems into it — and the invitation must name that account's own
address. That rule is not tidiness: in the anonymous flow the proof that the redeemer holds the
invited mailbox is that the password link is sent to it, and no mail is sent on the signed-in path, so
without the check anybody holding a code, a surname and a date of birth could attach **their own**
account to somebody else's firm. A code in a link is carried across the flow per-tab so nobody has to
hold it in their head; only the code, never the two facts that make it worth anything.

**The one refusal is now literally one.** Both redemption routes resolve the three facts through
`invitation-redemption.ts`: one lookup, one unmatchable-digest comparison, one balancing write, one
sentence, both budgets. A mismatched address answers byte-for-byte what an unknown code answers, which
`apps/api-worker/test/account-first-joining.test.ts` asserts by comparing the whole observable body
including the attempt budget.

**A firm's own name was being shown as its internal handle.** A self-serve firm's `firm.name` is the
registration's handle — deliberately, because firm names are not unique in the world and a unique
column over them would let a stranger probe for any firm by trying to register its name — while the
readable name lives in `display_name`. The chokepoint resolved `name`, so the bootstrap reported
`registration_an4N2sZ…` as the firm. Found by the founding test landing in the app one step earlier
than the old flow ever did.

## Public

**Signing up is now one short form.** Creating an account no longer starts by asking which kind of
person you are. You give your name and email address, confirm it, set a password, and you are in.

**Then you say where you work, from inside the app.** A welcome screen offers the two things that are
real: **start a new law firm**, or **enter an invitation code** from a firm that has invited you.
Starting a firm takes a moment to build, and the screen says so and moves on by itself when it is
ready — you can close the page, and signing in again brings you back to wherever it got to.

**If you were invited, nothing you already do has changed.** You can still redeem your code without
making an account first; that path is unchanged. If you make an account first, paste the code on the
welcome screen instead — it has to be the invitation sent to your own email address, which is what
keeps somebody who has merely seen your code from joining your firm in your place.

**Coming back later costs nothing.** An account with no firm yet is a real account: it signs in, it
can reset its password, and it returns to the same welcome screen until you are ready to choose.

What the screens do is described in [Joining Magna Carta](features/joining-magna-carta.md).
