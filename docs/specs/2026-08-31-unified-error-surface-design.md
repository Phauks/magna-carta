# Unified error surface — analysis and design

**Date:** 2026-08-31
**Status:** Analysis complete; design accepted with four decisions recorded in section 6 and three
presentation questions still open in section 9. Not built.
**Scope:** How a failure reaches a person in `apps/web` — the client-side problem model, the one
screen and one inline band that render a failure, the diagnostics a report needs, the reporter that
sends it, and the crash boundary that catches what never reached a surface at all.
**Excludes:** the server side of the error standard, which is built and is not reopened here
(`@magna-carta/telemetry`, the RFC 9457 problem document, the `POST /v1/incidents` route). Also
excludes whatever is currently making the API answer badly — this is about how the app _tells_ a
person, not about the fault itself.

**Binding inputs:** [`../conventions/error-logging.md`](../conventions/error-logging.md) (the
standard, and its own record that the client half is unbuilt); golden rule 4 in
[`../../CLAUDE.md`](../../CLAUDE.md) (one pipeline, redact by default, a user-facing Error ID);
the **Error** state required of every page archetype in
[`2026-06-12-page-archetypes.md`](2026-06-12-page-archetypes.md); the owner's standing rulings in
[`../conventions/design-corrections.md`](../conventions/design-corrections.md) — error copy is
per-channel and specific, no info lines, no dead controls, a transient upstream fault is retried
visibly.

---

## 1. The finding in one paragraph

The server half of the error standard is built and good: every failure answers an RFC 9457 problem
document with a registered `type` (106 of them), a `title`, a `detail`, an `errorId`, and — where the
failure has a remedy — the fields that name it (`requestAccess`, `stepUpRequired`,
`attemptsRemaining`, `retryAfterSeconds`, per-field `errors`). The client half was never built. In
its place, 37 files each independently turn a problem into one sentence, at 51 call sites; 23 of
those 37 discard the Error ID before it can reach a screen; the client's problem type keeps 4 of the
API's 12 fields and drops the rest unread; four separate modules parse the problem document with
four separate copies of the same function; two areas have grown near-identical 145-line failure
screens and near-identical 145-line report dialogs that have already drifted apart; and nothing
catches a client-side exception at all. The result is that the app is worse at explaining a failure
than the API is at describing one, and it gets worse per surface added.

## 2. What is built, and where it stops

| Layer                                                                                     | State                                                                                       |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Problem document, `type` registry, `errorId` minting, correlation, `app.onError` boundary | **Built** — `apps/api-worker/src/http/contracts/problem-types.ts`, `@magna-carta/telemetry` |
| Incident intake (`POST /v1/incidents`, firm-scoped row, outbox message)                   | **Built**                                                                                   |
| Client problem model                                                                      | **Partial** — `apps/web/src/lib/api/request.ts`, 4 of 12 fields                             |
| One failure screen                                                                        | **Absent** — two area-local copies exist                                                    |
| One inline failure band                                                                   | **Absent** — 76 `danger`-variant `<Alert>` compositions across 68 files                     |
| Error ID on screen                                                                        | **Partial** — present on 14 of 37 failing surfaces                                          |
| Breadcrumb ring buffer                                                                    | **Absent** — the reporter posts `breadcrumbs: []`                                           |
| Crash boundary (`svelte:boundary`, `onerror`, `unhandledrejection`, `handleError`)        | **Absent** — no `hooks.client.ts` in the app                                                |
| "Report a problem" always available                                                       | **Absent** — reachable only from the costs and billing failure screens                      |

The convention file already predicted this split: it books the client reporter, the breadcrumb
buffer, the Error ID surfacing and the two report surfaces as inherited work that "arrives with the
UI surfaces". The UI surfaces arrived; the inherited work did not.

## 3. Findings, with evidence

### F1 — The client throws away two thirds of what the API tells it

`Problem` on the wire carries `type`, `title`, `status`, `detail`, `errorId`, `correlationId`,
`instance`, `errors[]`, `requestAccess`, `stepUpRequired`, `attemptsRemaining`, `retryAfterSeconds`
(`packages/api-client/src/types.gen.ts:14`). `ApiProblem` in the app keeps `status`, `type`, `detail`
and `errorId` (`apps/web/src/lib/api/request.ts:19`). Everything else is parsed off the response and
dropped on the floor.

This is not cosmetic. `requestAccess` and `stepUpRequired` are emitted at 6 places in the API worker
and read at **0** places in the app: the server says "this member can ask for access to this" or
"re-authenticate and this will work", and the screen says "Something went wrong." Those two fields
are the difference between a dead end and a next step, and the app cannot see them.

`title` matters differently: it is the server's own short name for the failure and it is the natural
heading for a unified screen. Dropping it is why every surface has had to invent its own heading.

### F2 — There are four problem parsers, and the fourth has been predicted in writing

`readProblem` is implemented independently in `lib/api/request.ts`, `lib/auth/joining-api.ts`,
`lib/tools/whois/whois-lookup.ts`, and `lib/tools/safe-browse/safe-browse.ts`. `joining-api.ts` says
so in its own header comment, and states the exit condition: _"When a fourth surface wants it, the
helper moves to one shared home and all four follow."_ The fourth surface arrived. The comment's own
condition is met and is the cleanest possible authority for doing this now.

The divergence is already load-bearing rather than stylistic: `joining-api.ts` reads
`attemptsRemaining` and `retryAfterSeconds` **because** the shared helper does not. A surface that
needed a field the common path discarded forked the common path. That is the mechanism by which this
gets worse, and it has already run once.

### F3 — 51 sites hand-convert a problem into a sentence; 23 of 37 files lose the Error ID

The dominant idiom is `problem.detail ?? "<a local sentence>"`, in 37 files. Of those, 23 contain no
reference to `errorId` anywhere — the correlation handle is read off the wire by the transport and
then discarded by the caller. Golden rule 4 requires that every error surface a user-visible Error
ID; on the majority of failing surfaces in the app today, it does not.

The worst instance is structural rather than local. `lib/matters/paged-list.svelte.ts:94` is the
shared list machine behind 9 surfaces (the matters docket, contacts, the custody register, holds,
overdue checkouts, matter time, costs and calendar tabs). It collapses the whole outcome to
`failure: string`:

```
this.failure = result.kind === "transport"
  ? `Nothing answered. ${this.#whenUnreadable}`
  : (result.problem.detail ?? this.#whenUnreadable);
```

Every consumer of it is therefore _incapable_ of showing an Error ID, a status, or a remedy, no
matter what its own template does. One field on one class is the single highest-leverage fix in this
document.

### F4 — Two areas have grown the same screen twice, and it has drifted

`lib/costs/cost-error-state.svelte` and `lib/billing/billing-error-state.svelte` are the same
component: the same reassurance-first paragraph, the same four-row Request / Answer / Time / Error ID
definition list, the same three-step numbered remedy, the same Retry + Report pair. They differ in
the noun. `lib/costs/cost-problem-report-dialog.svelte` (154 lines) and
`lib/billing/billing-problem-report-dialog.svelte` (138 lines) are likewise the same dialog — and
have **already diverged**: costs offers a screenshot checkbox behind a Soon affordance, billing does
not; billing sends `appVersion` from the dialog, costs sends it from its own report module.

These two are also, by a distance, the best failure surfaces in the product. The unified screen
should be an extraction of them, not a new invention — the design work is done and reviewed, it is
simply trapped in two area folders.

### F5 — Nothing catches an exception that never reached a surface

There is no `hooks.client.ts`, no `handleError`, no `svelte:boundary`, and no `onerror` /
`unhandledrejection` handler anywhere in `apps/web`. `+error.svelte` catches load-time failures only.
A throw inside an event handler, an effect, or a component render leaves the user with a screen that
silently stops working and a console they will never open. No Error ID is minted, and there is
nothing to report.

### F6 — A member cannot report a problem unless they are looking at costs or billing

"Report a problem" exists on four files, all of them in those two areas. The standard names two
surfaces: the crash screen, and an always-available entry in the help menu. Neither exists. During an
API incident this is the difference between one usable signal per affected member and none.

### F7 — Reports carry no breadcrumbs

`lib/costs/cost-problem-report.ts:32` posts `breadcrumbs: []`. The API accepts and stores them; the
ring buffer that would fill them was never built. Every report therefore arrives with an Error ID and
a sentence, and nothing about what the person was doing beforehand.

### F8 — The app cannot tell "this read failed" from "the API is unavailable"

Every surface reports its own local failure in its own words. When the API is broadly unhealthy —
which is the situation prompting this work — a member sees six differently-worded local failures on
six panels of one screen and no statement that the platform is degraded. The status worker
(`apps/status-worker`) exists and the app does not consult it or link to it from any failure surface.

The recent deploy-skew fix (commit `95a3e3a`) is the same lesson learned once, locally: a 404 from
our own API was reading as "your input is wrong" until the safe-browse tool special-cased it. That
correction lives in one tool's guidance function and binds nothing else.

## 4. What "unified" should mean

Not one screen for everything — that would be wrong, and the design corrections already forbid it
("error copy is per-channel and specific"). Failures arrive at three different scales and a person
needs a different amount of screen for each:

1. **A panel could not be read.** The panel is replaced by the failure state; the rest of the screen
   still works.
2. **The screen could not be read.** The screen's body is the failure state; the shell survives, per
   the existing in-shell `+error.svelte` ruling that an error must never strand the user.
3. **The app broke, or the page never loaded.** The bare screen.

What unifies them is not the layout. It is that all three render **the same model**, expose **the
same diagnostics block**, offer **the same two controls**, and reach **the same reporter**. One
model, one vocabulary, three sizes.

## 5. Proposed design

### 5.1 One model — `Problem`, complete

Widen the client's problem type to every field the contract sends, and delete the three forked
parsers in favour of it. Keep `ApiOutcome`'s three-way split (`ok` / `problem` / `transport`) exactly
as it is — the distinction between "the server refused" and "nothing answered" is correct and is what
lets the screen say the true thing. Add the two facts the transport knows and the document does not:
the request line as the app made it, and the instant it failed. Both are already displayed by the
costs and billing screens, and both are currently reassembled by hand at each call site.

The resulting record is the whole input to every failure surface. A surface passes it along; it never
destructures it into a string.

### 5.2 One presenter — status and type to guidance

A single pure module maps a problem to `{ tone, title, message, remedy }`, generalizing the three
mappers that exist today (`joining-messages.ts`, `whois-lookup.ts`'s `problemGuidance`,
`safe-browse.ts`). It must be pure and unit-tested, because on the auth surface the wording is a
security decision rather than a copy decision, and that property has to survive the merge.

It has to carry the lessons already paid for:

- A 404 from our own API is **service skew**, not a bad address (learned in commit `95a3e3a`).
- A 429 is **not a verdict** on what was typed.
- A 5xx says nothing about the input.
- A `stepUpRequired` or `requestAccess` problem is a **next step**, not a failure — the surface
  renders the control that takes it.
- `retryAfterSeconds` drives the retry control's disabled window, so the member is not made to be the
  retry loop (the standing correction).
- A surface may always override the message for its own channel. The presenter is the default, never
  a ceiling — otherwise it reintroduces the generic-message problem the corrections forbid.

### 5.3 One component family, in the design system

Three exports, one model, shared internals:

- `failure-state` — the full-screen and full-panel form. Heading, the server's own sentence, the
  reassurance line where the area supplies one, the diagnostics list, Retry and Report a Problem.
- `failure-band` — the inline form for a failed action inside a working screen. One line, the Error
  ID as a copyable chip, Retry. Replaces the 76 `danger`-variant `<Alert>` compositions spread
  over 68 files.
- `failure-details` — the diagnostics block itself, promoted from `lib/components/error-details.svelte`.
  Build identity, time, status, request, message, Error ID, correlation ID, user agent, as selectable
  monospace text with one-click copy.

Extract from the costs and billing pair rather than designing anew. The reassurance sentence stays a
prop, because it is the one genuinely per-area line and it is the most valuable sentence on the
screen: _the record is unharmed_. A person whose trust ledger will not load does not know whether the
money is gone.

The dev-only gallery goes at `/developer-console/failure-states`, beside `table-states` and
`sign-in-screens` — the established precedent for a reviewable state the real data cannot reach.

### 5.4 One reporter

Promote `cost-problem-report.ts` and the report dialog to `lib/diagnostics/`, delete both area
copies, and add the breadcrumb ring buffer the standard specifies (actions and identifiers, never
field content; fixed capacity; in memory only). Add the help-menu entry so a report does not require
having first found a broken panel. The dialog keeps the costs copy's plain statement of exactly what
is sent — that sentence is why a person is willing to send it.

### 5.5 One boundary

Add `hooks.client.ts` with `handleError`, plus `onerror` and `unhandledrejection` handlers and a
`svelte:boundary` at the app shell. Mint a client-side Error ID at the boundary so a crash that never
reached the server still has a handle a person can quote, and render `failure-state` inside the shell
where the shell survives.

### 5.6 One platform-health signal

When several reads fail at once, or a problem is a service-skew 404, the failure state adds one line
naming the platform rather than the panel, and links to the status page. This is the piece that
directly answers the current API trouble: it turns six confusing local failures into one accurate
statement.

## 6. Decisions taken

Settled by the owner on 2026-08-31 against the review sheet.

- **The whole change lands as one merge.** Not a foundation branch with the adoption behind it: the
  branch stays open until all seven steps below are done and every surface renders through the new
  components. The consequence is accepted and managed rather than argued with — the branch is long-
  lived, so it syncs `main` on a cadence, and it is committed step by step so each commit is sound on
  its own even though none of them ships alone.
- **The presenter's default sentence is a floor, not a ceiling.** It always produces a usable
  sentence; a surface overrides it wherever its failure is genuinely its own — auth, trust, custody,
  conflicts. Nothing renders blank, and the channels that fail distinctly keep saying so. This is the
  reading of "error copy is per-channel and specific" that the corrections support.
- **The platform notice ships now, on client-side evidence.** It triggers on what the app already
  knows — several reads failing at once, or a 404 from our own API — rather than waiting on a health
  signal the app does not consult. It covers the deploy-skew case that already cost one round of
  confusion, and it is the piece that most directly answers the current API trouble.
- **The crash boundary does not auto-file.** A crash mints a client-side Error ID and offers "Report a
  problem"; nothing is sent unless a person presses it. This holds the Off/strict default the
  diagnostics setting already defines, and keeps reporting user-initiated as the standard specifies.

## 7. Order of work

One merge, but seven commits — each sound on its own, in this order.

1. **Widen the model; fold the four parsers into one.** No visible change; unblocks everything else.
   The `joining-api.ts` comment already authorizes it.
2. **Fix `paged-list.svelte.ts` to hold the problem, not a string.** One field. Nine surfaces gain the
   ability to show an Error ID.
3. **Extract `failure-state`, `failure-band` and `failure-details` into the design system**, from the
   costs and billing pair. Point costs and billing at them; delete the two copies.
4. **Promote the reporter and the dialog** to `lib/diagnostics/`; delete the area copies; add the
   help-menu entry; build the breadcrumb buffer.
5. **Write the presenter** and adopt it across the 37 files, keeping every per-channel override that
   exists today and adding one wherever the default would be wrong. The long tail.
6. **Add the crash boundary**, minting a client-side Error ID and offering the report rather than
   filing it.
7. **Add the platform notice**, triggered on client-side evidence.

The dev-only gallery at `/developer-console/failure-states` is built alongside step 3 and grows with
each subsequent step, so every state stays reviewable without needing real data to reach it. This is
the review surface the standing direction calls for — the sheet published for this design round is a
decision aid, not a screen to port from.

## 8. Fitness function

The existing `errorId-coverage` fitness function guards the server. The client needs its counterpart,
or this decays again: a source scan that fails when a `kind === "problem"` branch reduces the problem
to a string without passing it to one of the three failure components. That is the rule that stops
the 38th surface from being written the way the first 37 were.

## 9. Still open

Three questions the review sheet renders both ways, to be answered by looking rather than by
argument. They change presentation only, so steps 1 and 2 do not wait on them.

1. **Is the diagnostics block always visible, or behind "Show technical details"?** Costs and billing
   show it unconditionally today and that is the better instinct — the person who can act on it is the
   one looking at the screen. The counter-case is the bare crash screen, where an unexplained wall of
   monospace is the first thing a person meets.
2. **Does the inline band show the Error ID, or carry it only in Copy details?** Shown is honest and
   repeats an eight-character code on every failed action; copy-only is quiet and loses the ID from a
   screenshot, which is how most reports actually arrive.
3. **Does the reassurance line stay?** "The record itself is unaffected — nothing was changed by this
   failure" is the most valuable sentence on the costs and billing screens and the one most at odds
   with the no-info-lines ruling. It is a fact about this result rather than prose about the screen,
   which is the exemption the ruling names, but the call is the owner's.
