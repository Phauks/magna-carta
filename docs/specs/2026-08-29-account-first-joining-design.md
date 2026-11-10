# Account-first joining — design

**Date:** 2026-08-29
**Status:** Design proposed and built to the seam. Five owner decisions open (see _For the owner_).
**Scope answer:** the owner's words — "instead of deciding if they are creating a law firm, or what
kind of user … the only point of this screen is to have someone make an account. So we should reflow
so that after they make an account, they are logged into the app, potentially on a special dedicated
screen, which defines their account type."
**Scope:** the joining surface end to end — what `/register` asks for, what the confirmation token
buys, the account that exists before any firm does, the in-app screen that resolves it, and the two
server routes that screen calls. **Excludes** the credential model (passwords, passkeys, one-time
links, federation), which belongs to the unified-identity design and is untouched here.

**Binding inputs, in order of authority:**

- The owner's ask above. It is a reflow of a working surface, so its first constraint is that the
  working surface keeps working while it is reflowed.
- [`2026-08-13-unified-identity-design.md`](2026-08-13-unified-identity-design.md) — the recorded
  identity model. This design is **subordinate** to it and reuses two of its conclusions rather than
  inventing against them: a principal that holds **no firm** is a state that model already requires
  (its section 5 argues `user.firm_id IS NULL` for portal clients precisely because it is
  closed-by-default), and "a method proves you are the principal; it never decides who the principal
  is, and never decides what the principal may then do" is the sentence that makes account-first
  correct rather than merely convenient.
- `ADR-0280` (joining the platform), `ADR-0003` (tenancy), `ADR-0067` (route metadata at the
  chokepoint), `ADR-0052` (the reserved cross-firm 404).
- The neutral-refusal posture already built into `routes/session/registrations.ts` and
  `routes/session/invitations.ts`. Nothing here may weaken it, and one new route inherits it whole.

---

## 1. The sentence this design turns on

> **Creating an account and acquiring a firm are two acts, and the platform was making a stranger
> perform the second one before the first.**

The fork at `/register` asks a visitor to classify themselves — client of a firm, works at a firm,
founding a firm — before anything about them exists. That is a question about their **relationship to
a firm**, and the surface asking it is the surface whose only job is to establish **who they are**.
The unified-identity design already names this failure in another costume: an invitation kind that is
the only record of whether somebody is staff or a client "has made a credential-issuing event into
the identity model, which is the defect already sitting in the tree." The role fork is the same defect
one step earlier — a _registration_ event deciding the identity model.

Account-first separates them. `/register` makes a person. A dedicated in-app screen, reached with a
real session, makes them a member of a firm.

---

## 2. The flow as built (2026-08-29)

**The browser.** `/register` renders the three-door fork (`register-screen.svelte`) and navigates —
without calling the API — to one of two places, because two of the three doors are the same door:

| Door                             | Goes to                | What happens                                                                       |
| -------------------------------- | ---------------------- | ---------------------------------------------------------------------------------- |
| "I am a client at a law firm"    | `/register/invitation` | code + surname + date of birth → one neutral refusal or a mailed password-set link |
| "I work at a law firm"           | `/register/invitation` | identical                                                                          |
| "I want to start a new law firm" | `/register/firm`       | firm name → person's details + two acknowledgements → one confirmation email       |

`/register/confirm` spends the emailed token. `apps/web/src/routes/(app)/+layout.ts` guards every
signed-in surface by calling `GET /api/v1/me` and treating a 401, and only a 401, as "not signed in".

**The server.** `POST /api/v1/registrations` carries a `role` discriminator. `clientOfFirm` and
`firmMember` write nothing and answer the constant `{ next: "redeemInvitation" }`. `foundFirm` writes
one `registration` row and mails a confirmation token; an address that already has an account gets a
different **mail**, never a different **answer**.
`POST /api/v1/registrations/confirmations` flips the row to `confirmed` and commits a
`firm.provision` outbox message in the same batch. `firm-provision-consumer.ts` provisions the firm
and — because the owner has no account yet — **creates the owner's user row inside the activation
batch** and mails a password-reset link, which is their activation.
`POST /api/v1/invitations/redemptions` does the analogous thing for an invitee: it **inserts the
`user` row itself** and mails the password-set link.

**Better Auth** (`auth.ts`) runs with `disableSignUp: true` and `requireEmailVerification: true`.
There is no public signup route. Every account in existence was created by one of those two
server-side paths.

**Two facts from that inventory decide most of this design:**

1. **Both account-creating paths INSERT the user row**, and both rely on `UNIQUE(user.email)` as a
   fence. An account that already exists therefore _cannot_ redeem an invitation — the insert
   collides and the caller gets the neutral refusal. Account-first breaks invitations unless
   redemption gains a path that **attaches** a firm to an existing account instead of creating one.
2. **`user.firm_id` is `NOT NULL`** with a foreign key to `firm.id` (control-plane baseline). A
   signed-in person with no firm is not merely unhandled today; it is unrepresentable.

---

## 3. The new flow

Five lines:

1. **`/register` creates a person, full stop** — first name, last name, email, the two
   acknowledgements. One call, one confirmation email, no fork.
2. **Confirming the token creates the account** — a `user` row with **no firm** — and mails the link
   that sets its password, which is the same activation machinery an invited member already uses.
3. **Setting the password and signing in lands on `/welcome`**, because `GET /api/v1/me` now answers
   `firm: null` and the `(app)` guard routes a firmless session there instead of into the shell.
4. **`/welcome` resolves what they are**: found a firm (real), or redeem an invitation into a firm
   that already exists (real). Founding is asynchronous, so the screen has a waiting state.
5. **A firm attaches, `/api/v1/me` answers a firm, the guard lets them in.** Abandoning the flow
   costs nothing: the next sign-in returns to `/welcome` in exactly the state they left.

### 3.1 Walk: the founder

`/register` → confirmation mail → `/register/confirm` (token spent on a deliberate press, unchanged)
→ activation mail → password set → sign in → `/welcome` → **Start a law firm** → firm name →
`POST /api/v1/me/firm` answers `202 { status: "provisioning" }` → the screen shows **"We are building
your workspace"** and polls `/api/v1/me` → the provisioning consumer builds the bucket, mints the
key, adopts this account as the firm's owner, and writes the `member.provision` row carrying
Owner/Admin → `/api/v1/me` answers a firm → the screen sends them to `/home`.

The founder is **not** mailed a second activation link, because they already have a credential. That
is the one behavioural difference in the provisioning consumer and it is what the reflow buys: the
old flow's "check your email, again" step is gone.

### 3.2 Walk: the invitee who signs up first (account-first)

`/register` → confirm → password → sign in → `/welcome` → **I have an invitation code** → code,
surname, date of birth → `POST /api/v1/me/invitation-redemptions` → the invitation's firm is attached
to the account they already hold → `/home`.

No mail is sent, because there is nothing left to prove: this account's mailbox was proven twice
already (the confirmation token and the password-set link).

### 3.3 Walk: the invitee who arrives with a code (code-first)

Two sub-cases, and **neither may lose the invitation**:

- **They have no account.** `/register/invitation` still exists, still answers, and still works
  exactly as it does today — code → account created → password-set link. This is the compatibility
  path and it is also, for somebody who was invited and never wanted a Magna Carta account of their
  own, the shortest correct path. It stays.
- **They follow a code into the account-first door.** `/register?invitation=<code>` and
  `/welcome?invitation=<code>` both read the code out of the query string and carry it forward: the
  register screen stashes it (session storage, per-tab, cleared on use), and the onboarding screen
  opens **on the redemption step with the code already in the field**. A person who pastes a code
  into an account they have just made never has to hold it in their head across three screens.

The stash is per-tab and short-lived by construction, and it holds only the code — never the surname
or the date of birth, which are the two facts that make the code worth anything and which the person
types once, at the moment of redemption.

---

## 4. The orphan account

The state account-first creates: a signed-in person who belongs to no firm. Four questions, answered
in the order a request meets them.

### 4.1 Representation — `user.firm_id` becomes nullable

One control-plane migration rebuilds `user` with `firm_id` nullable (SQLite cannot drop `NOT NULL` in
place; the rebuild preserves every column, the unique index on `email`, and the foreign key, which a
`NULL` satisfies trivially). `control-plane-schema.ts` drops `.notNull()` on that column, and the
Better Auth additional field becomes `required: false`.

**Why nullable rather than a placeholder firm.** A sentinel firm row would be a real tenant with a
real bucket, a real key and a real place in every fleet-wide enumeration, shared by every person
mid-onboarding — which is a cross-tenant container by construction. `NULL` is the honest
representation of "no firm", and it is the one the unified-identity design already argues for, for
the reason that matters here: a surface that forgets to ask resolves **no firm** and answers the
reserved 404, rather than resolving _somebody's_ firm and answering their data.

The cost is stated rather than hidden: `firmId` becomes `FirmId | null` at the session boundary and
the compiler forces each reader to say what it does with `null`. There are three such readers
(`session-context.ts`, the chokepoint, `me.ts`) because every other reader takes its firm from the
chokepoint's already-resolved context, which cannot be firmless.

### 4.2 Admission — one new route-metadata field, closed by default

`RouteMeta` gains `firmlessSession?: "reject" | "allow" | "only"`, defaulting to **`"reject"`**.

| Value      | A session with **no** firm            | A session **with** a firm | Used by                               |
| ---------- | ------------------------------------- | ------------------------- | ------------------------------------- |
| `"reject"` | the reserved 404 (structural absence) | resolved as today         | every route in the platform but three |
| `"allow"`  | admitted; no firm context, no RBAC    | resolved as today         | `GET /api/v1/me`                      |
| `"only"`   | admitted; no firm context, no RBAC    | **the reserved 404**      | the two onboarding mutations          |

Three properties make this safe to add rather than merely convenient:

- **Default-reject means the 481 existing routes change behaviour not at all.** A firmless session
  reaching any of them gets what a cross-firm request gets — absence, never an oracle.
- **`"only"` is what makes the mutations legal.** `defineOpenAPIRoute` refuses an authenticated
  mutating route with `permission: null`, because the chokepoint reads that as "any authenticated
  user" — privilege escalation by omission. A firmless principal holds no permission in any firm, so
  the onboarding mutations cannot name one; `"only"` earns the exemption by making the route
  **structurally unreachable** for anybody who has a firm. "Found a firm" is not an act a member of a
  firm can reach at all, which is exactly right: a second firm is not a thing this model has.
- **Nothing else moves.** Idempotency and the rate limiter still run for every surface, in the same
  order, keyed the same way (an IP-scoped bucket, since there is no firm to scope to).

### 4.3 What `/api/v1/me` says

`firm` becomes nullable and one field joins it:

```jsonc
{
  "user": { "id": "usr_…", "name": "…", "email": "…" },
  "firm": null,                    // or { id, name }
  "permissions": [],               // empty for a firmless session — no firm, no member row
  "channel": "stable",             // the platform default; a channel is a firm's property
  "flags": { },                    // evaluated with no firm, so every flag is its stable default
  "joining": { "state": "chooseFirm" | "firmProvisioning" }   // present ONLY when firm is null
}
```

`joining.state` is what lets the onboarding screen poll one endpoint instead of two: after
`POST /api/v1/me/firm` the same bootstrap call answers `firmProvisioning` until the consumer
finishes, and then answers a firm. The waiting state is a fact the server holds (a confirmed
registration for this account with no firm recorded yet), never a flag the browser remembers — a
person who closes the tab mid-build reopens it into the waiting screen, which is the correct
behaviour and the one a client-side flag would get wrong.

### 4.4 The shell renders nothing

`/welcome` lives **outside** the `(app)` group. There is no navigation to render for somebody with no
firm — no matters, no timer, no notifications, all of which are per-firm reads that would 404 — so
the onboarding screen renders in the same auth frame the sign-in and registration screens use. It is
the only signed-in surface that does. The guard makes it mutually exclusive with the shell in both
directions: a firmless session inside `(app)` is redirected out to `/welcome`, and a session **with**
a firm landing on `/welcome` is redirected in to `/home`.

### 4.5 Coming back a week later

Nothing expires, because nothing is held in flight. The account is a real account: it signs in, it
can reset its password, it holds a second factor if it enrolled one. `/api/v1/me` answers
`firm: null`, the guard sends it to `/welcome`, and the screen offers the same two choices it offered
a week ago. The only state that can be stale is a firm build that never completed, and that is the
outbox relay's problem — the same at-least-once row that already resumes a half-built firm.

An account that never chooses is a row in the control plane and nothing else: no bucket, no key, no
Durable Object, no entry in any fleet-wide sweep. That is deliberate and is the anti-abuse argument
in section 5 restated as a storage fact.

---

## 5. Anti-abuse — the real cost of this change, and what it actually is

### 5.1 The claim to check

Today `disableSignUp: true` means an account comes into being only through a registration whose
intent was declared, or through an invitation. Account-first is, on its face, a public signup door.
It is worth being precise about what changes, because most of the fear does not survive contact with
what the endpoint already is.

### 5.2 `disableSignUp` does not change, and this is not a new endpoint

**The reflow is a restructuring of the existing registration + confirmation machinery, not a new
signup route.** Better Auth's `/sign-up/email` stays refused. The account is created by our own
confirmation handler, in exactly the way `invitations.redemptions` already creates one — a
server-side insert of an unverified, credential-less `user` row whose activation is the mailed
password-set link.

Concretely, `POST /api/v1/registrations` is unchanged in every respect that matters to an attacker:
same route, same chokepoint, same `auth` rate-limit bucket (the tightest the platform has), same
dormant Turnstile gate, same one-row-and-one-email cost, same identical answer for a taken address
and a free one. The `role` field gains one value. The **only** thing that moves is what a
**confirmed** token buys.

| Cost to an anonymous caller  | Before                                                | After                                                 |
| ---------------------------- | ----------------------------------------------------- | ----------------------------------------------------- |
| One unconfirmed registration | 1 control-plane row + 1 email                         | unchanged                                             |
| One **confirmed** token      | 1 firm, 1 R2 bucket, 1 wrapped key, 1 user, 2nd email | **1 user row + 1 email** — no bucket, no key, no firm |

That table is the whole security argument, and it points the other way from the intuition: **the
confirmed path gets cheaper, not more expensive.** Today, a spammer who can receive mail at a
throwaway address gets a provisioned tenant with a bucket and a minted key. After this change they
get a row that can reach two routes and read nothing. Firm provisioning moves _behind_ an
authenticated act by a proven mailbox.

**So: `disableSignUp` stays `true`, and no owner ratification is needed for the reflow itself.**
Nothing in this design opens Better Auth's signup route, and nothing here should be read as licence
to open it later "since we have a signup screen now" — the account is created by our handler, on our
terms, after our confirmation, and that distinction is the control.

### 5.3 The gate that is genuinely load-bearing, and is dormant

The email-confirmation gate is kept exactly as it is, and it is now the **only** thing standing
between an anonymous caller and a `user` row. That raises its importance without changing its
mechanism: an unconfirmed registration still creates no account, and a confirmation still requires
possession of the mailbox.

Human verification (`apps/api-worker/src/http/human-verification/`) already guards this endpoint on the
server and is **dormant**, because no `TURNSTILE_SECRET_KEY` is provisioned and nothing in the
browser mints a token. That was survivable when the IP-keyed limit was one of two controls in front
of a row-and-an-email. It is still survivable now — the cost per confirmed account is one row — but
the case for activating it is stronger after this change than before it, and the ordering constraint
is already recorded in [`../deploy-queue.md`](../deploy-queue.md): **the widget must exist in the
browser before the secret is set**, or every joining call 403s. That is owner decision **D3**, and it
is a deployment step rather than a code change: `resolveHumanVerificationPort` selects on the
secret's presence and this design touches neither side of it.

### 5.4 The enumeration posture is unchanged, and one new refusal inherits it

`POST /api/v1/me/invitation-redemptions` is authenticated, so it is not an anonymous oracle. It still
answers **one refusal** for every unsuccessful combination, built by the same single construction
site the anonymous route uses, for the same reason: an authenticated stranger who obtained a code is
still a stranger, and a per-field verdict would still confirm that a named person was invited to a
named firm. The caller-keyed attempt ladder is keyed on the session's user rather than the IP, and
the invitation's own depth budget is spent identically and stays silent.

### 5.5 One new rule the invitation path needs

**The invitation's address must equal the signed-in account's address.** A mismatch is refused, with
the same one sentence as every other refusal.

This is not tidiness — it is the possession proof, preserved. In the anonymous flow, redemption's
real proof is that the password-set link goes to the **invited** mailbox, so somebody who guessed all
three facts but does not hold that mailbox gains nothing. In the account-first flow no mail is sent,
so without this rule a person who obtained a code, a surname and a date of birth could attach **their
own** account, with **their own** credential, to somebody else's firm. Requiring the addresses to
match restores exactly the proof the mail was providing.

The cost is real and is stated: somebody who registered with a personal address and is invited at
their work address cannot redeem into the account they made. The remedy is the one that already
exists and stays working — redeem the invitation anonymously at `/register/invitation`, which creates
the account for the invited address. The screen says so, in those words, rather than leaving somebody
to guess.

---

## 6. API deltas

Contract discipline: zod schemas, re-emitted document, regenerated client, in the same commit.

### 6.1 Changed

**`POST /api/v1/registrations`** — `role` gains `"account"`, and `role` becomes **optional**,
defaulting to `"account"`. The three existing values behave exactly as they do today, byte for byte.
`firmName` is ignored on the account door (there is no firm to name yet).

**`POST /api/v1/registrations/confirmations`** — branches on the **stored row's** role, not on
anything the caller says:

- `role = 'foundFirm'` → unchanged: queue `firm.provision`, answer `status: "provisioning"`.
- `role = 'account'` → create the firmless `user` row, request the password-set link, answer
  `status: "accountCreated"`. The response schema's `status` becomes that two-value enum.

Branching on the row is what makes the migration free: a registration started under the old flow
carries `foundFirm` and completes under the old rules **after** this ships, with no window and no
migration of in-flight rows (section 8).

**`GET /api/v1/me`** — `firm` nullable, `joining` added, `firmlessSession: "allow"`. Every existing
consumer reads `firm` only after a 200 and there is exactly one of them (the SPA guard), which is
changed in the same commit.

### 6.2 Added

**`POST /api/v1/me/firm`** — `{ firmName }` → `202 { status: "provisioning" }`.
`firmlessSession: "only"`, `permission: null`, `idempotency: "optional"`, `rateLimit: "auth"`,
audited. Writes a confirmed `registration` row for this account (role `account`, its firm not yet
recorded) and commits the `firm.provision` outbox message in the same batch — the same transactional
outbox the anonymous path uses, so the same relay, the same retries, the same resume. A second submit
finds the pending registration and answers the same 202 rather than queueing a second firm.

**`POST /api/v1/me/invitation-redemptions`** — `{ code, lastName, dateOfBirth }` → `200 { firmId }`.
`firmlessSession: "only"`, `permission: null`, `idempotency: "optional"`, `rateLimit: "auth"`,
audited. Attaches the invitation's firm to the signed-in account, marks the invitation redeemed, and
commits the `member.provision` outbox row — the same three writes the anonymous route makes, minus
the user insert and minus the mail.

### 6.3 Not added, deliberately

No `GET /api/v1/invitations/{code}` preview, and no endpoint that reports whether a code is live. The
onboarding screen never asks the server about a code before the person has typed all three facts,
because a preview endpoint is the enumeration oracle the whole surface is arranged to refuse.

---

## 7. Screen inventory

| Screen                                                 | Route                                    | State                                                                   |
| ------------------------------------------------------ | ---------------------------------------- | ----------------------------------------------------------------------- |
| Create Your Account (`register-account-screen`)        | `/register`                              | empty · filled · pending · refused (with Error ID) · rate-limited       |
| Check your email (`check-email-screen`, reused)        | `/register`                              | after submit                                                            |
| Confirm registration (`confirm-registration-screen`)   | `/register/confirm`                      | unchanged; its success copy branches on the answered `status`           |
| Welcome — choose (`joining-choice-screen`)             | `/welcome`                               | the two live choices, plus what is honestly not built                   |
| Welcome — name your firm (`found-firm-screen`, reused) | `/welcome`                               | empty · filled · pending · refused                                      |
| Welcome — building (`firm-building-screen`)            | `/welcome`                               | waiting, polling, and the sentence that says a workspace is being built |
| Welcome — redeem (`redeem-invitation-screen`, reused)  | `/welcome`                               | empty · filled · pending · refused · attempts remaining · locked out    |
| Legacy fork                                            | `/register/firm`, `/register/invitation` | unchanged and still reachable (section 8)                               |

Four of the eight are components that already exist and are reused unchanged, which is the whole
reason the reflow is small on the browser side: the screens were always right, it was the **order**
that was wrong.

**What the choice screen offers, honestly.** Two live choices — start a law firm, redeem an
invitation. Nothing else is rendered as though it worked. The honest inventory in
`joining-availability.ts` gains the entries for the new steps, and the choice screen reads its
sentences from there rather than carrying its own: joining a firm by asking its administrator
(no route publishes a firm directory, and nothing should), and joining as a client of a firm without
an invitation (a firm's client list is the confidential fact — a client is invited or is not a
client), are both named as **not built** with their dependency stated, in the same register the rest
of the joining surface already reads from.

---

## 8. Migration and compatibility

Nobody is stranded, and nothing is timed.

| Person, mid-flight                              | What happens after this ships                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| Holds an unspent `foundFirm` confirmation token | `/register/confirm` spends it; the row says `foundFirm`; the **old** path runs whole |
| Holds an unspent invitation code, no account    | `/register/invitation` unchanged, still works                                        |
| Bookmarked `/register/firm`                     | Still renders and still works — unlinked, not removed                                |
| Bookmarked the three-door fork at `/register`   | Gets the new account form. The fork is the one screen deliberately retired           |
| Already has an account and a firm               | Nothing changes anywhere; the guard sees a firm and behaves exactly as before        |

The two legacy routes stay because production is currently the only way the owner can obtain an
account, and a joining flow that breaks is strictly worse than one that has not been reflowed. They
are removable once no `foundFirm` registration is live (the token's life is 24 hours) and no
invitation issued before the change is outstanding (default 14 days); that is a later, separate
deletion, and it is a deletion of two files rather than an unpicking.

---

## 9. Test plan

- **Routing states.** The guard: 401 → `/login` with `next`; 200 with `firm: null` → `/welcome`; 200
  with a firm → through; transport failure → render anyway (the existing behaviour, which a firmless
  branch must not disturb). `/welcome` in reverse: a session with a firm is sent to `/home`.
- **The onboarding screen's states.** Choose, naming, pending, building, redeeming, refused,
  attempts-remaining, locked out — and the invitation code arriving by query string.
- **The chokepoint.** A firmless session on an ordinary route gets the reserved 404 and never reaches
  the handler; on `"allow"` it reaches the handler with no firm context; on `"only"` a session **with**
  a firm gets the 404.
- **The server routes.** Founding queues exactly one provision and is idempotent under a double
  submit; redemption attaches the firm without inserting a user; a mismatched address is refused with
  the same sentence as a wrong code; the refusal never varies with what was found.
- **Compatibility.** A `foundFirm` registration confirmed after the change still provisions a firm
  and still mails the owner's activation link.

---

## For the owner

| #      | Question                                                                | Recommendation                                                                                                                                      |
| ------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | Does `disableSignUp` relax?                                             | **No, and it does not need to.** The account is created by our confirmation handler, not by Better Auth's signup route. Nothing here is gated on it |
| **D2** | Must the invitation's address equal the signed-in account's address?    | **Yes** — it is the possession proof the mail used to provide (5.5). The anonymous door remains for the personal-address case                       |
| **D3** | Activate Turnstile on the joining endpoints before or after this ships? | **Before**, in the deploy order already recorded: widget first, secret second. Not a code change; it is the deploy queue                            |
| **D4** | May a person who already has a firm found a second one?                 | **No** — `firmlessSession: "only"` makes the route unreachable for them. One person, one firm, as the tenancy model has always said                 |
| **D5** | Retire `/register/firm` and `/register/invitation` now or later?        | **Later**, as a separate deletion once nothing issued under the old flow is outstanding (section 8)                                                 |

---

## Sources

Read against the tree on 2026-08-29: `apps/api-worker/src/http/routes/session/registrations.ts`,
`routes/session/invitations.ts`, `routes/session/me.ts`, `src/auth.ts`, `src/firm-provisioner.ts`,
`src/background/firm-provision-consumer.ts`, `src/http/chokepoint/chokepoint.ts`, `src/http/contracts/route-meta.ts`,
`packages/database/src/control-plane-schema.ts`, and the joining surface under
`apps/web/src/routes/register/` and `apps/web/src/lib/auth/`.
