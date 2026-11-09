# Notification emails

_Built, and switched off. Your firm's outbound mail has not been set up yet, so **no notification email can reach anybody today** — nothing is being sent and nothing is being lost. When it is set up, the summaries described here begin arriving. Your own settings are on **Settings · Notifications**; the firm-wide ones described below are changed through the API until their screen ships._

## What arrives

Once a day — or once a week, if that is what you chose — Magna Carta emails you a **summary of what
is waiting for you in the app**. It looks like this:

> **Magna Carta — 6 items need your attention**
>
> Deadlines 3 · Documents 2 · Trust 1
>
> Open your notifications: https://…/notifications

That is the whole message. A count, the categories those items fall into, and a link.

## Why it says so little

**Because email leaves the building.** Everything you see inside Magna Carta is behind your sign-in,
and the software checks — every single time you look — that you are still entitled to see it. If you
come off a matter today, its items are gone from your list today.

An email cannot be taken back. It sits in a mailbox that may be backed up, forwarded, indexed by
whatever mail program you use, and shown on a phone's lock screen to whoever happens to be standing
there. If it named a matter, that naming would still be sitting in inboxes long after you stopped
working on the file.

And a matter's name **is** the client's name, in practice. Firms name matters after the parties and
the dispute. A matter number is barely better: anyone holding one of your old invoices or emails can
turn a number back into a client.

So the email tells you **how much** is waiting and **what kind**, and nothing else. A count says
something about your day. It says nothing about anybody's client.

**A notification email will never contain:** a matter name or number, a client's or an opposing
party's name, a document or file name, an email subject line, what a deadline is or when it falls,
an amount of money, an invoice number, or the name of anybody involved. If you ever receive one that
does, that is a fault worth reporting.

## What you control

Per **category** — deadlines, calendar, trust, billing, documents, custody, email, conflicts, jobs,
security, system — you choose:

- **whether it reaches your email at all**, and
- **how often**: daily, weekly, or off.

The defaults are daily for everything except **jobs** and **system**, which are off — a document
finishing conversion is something you are already watching.

Turning a category off means those items simply do not count toward your email. They are still in
your list inside the app, where they always were; the email just stops mentioning them.

**Your firm cannot switch your notification email on.** It can insist that certain things appear in
your list inside the app — that is its call, and the list is inside the software where the firm's own
rules apply. It cannot make mail arrive in your inbox, because your inbox may be personal, may be
somewhere your firm does not administer, and is past the point where the firm's controls reach.

Your firm may set a **default** cadence for a category, which applies until you choose your own. It
can only ever be a starting point: whatever you choose stands, including off.

## What your firm controls

Three settings belong to the whole firm rather than to any one person. Only Admin seats can
change them, and every change is written to your firm's audit log.

**Which categories everyone hears in app.** Your firm can turn a category on for everybody, and then
nobody can switch it off for themselves — the switch shows as locked, and says the firm locked it.
This works one way only. Your firm can insist that something reaches people; it cannot stop somebody
hearing about their own work, so a category your firm has left off is a starting point you can raise
rather than a limit you cannot.

Two categories — **security** and **trust** — are always on in the app whatever anybody sets, firm
included. They are the ones the software treats the way it treats the audit log.

**How long notifications are kept.** Anywhere from thirty days to a year; ninety days unless your
firm changes it. Shortening the window is not losing the record: the matter timeline and the audit
log keep their own history and are untouched by this. What it decides is how far back somebody
returning from leave can scroll — which is why the software will not accept anything under thirty
days, and will not accept five years either. A request outside the range is refused rather than
quietly adjusted, so you always know what you got.

If items were cleared away while you had not read them, your unread count tells you so rather than
showing a zero — "there is nothing you missed" is not a claim the software is in a position to make
about somebody who was away.

**What time the summaries go out** — see below.

## When it arrives

In your firm's own morning, not at some hour set by a clock on the other side of the world. The hour
is set once for the whole firm and starts at 7am; an Admin can move it to any hour of the day.
The time zone is your firm's main office, so it follows the office rather than needing to be kept in
step with it by hand.

A weekly summary arrives on Monday morning.

## When nothing arrives

**If there is nothing waiting, you get no email.** Not an email saying you have nothing — those teach
people to stop reading the ones that matter.

So a quiet inbox means one of three things, and they are genuinely different:

- there was nothing for you this period;
- you switched that category off; or
- your firm has not set up outbound mail yet, which is the situation today.

The software records which of the three it was for every single item, so if you ever need to ask
"should I have been told about this?", the answer exists and someone can look it up.

## What to do with the link

Follow it. The summary is a nudge, not a record — everything it counts is in your list inside the
app, in full, with the matter it belongs to, and checked against what you are entitled to see **at
the moment you look** rather than at the moment the email was written.

## Related

- [`your-notifications.md`](your-notifications.md) — the list inside the app that this email counts, and where you choose what reaches you
- [`case-calendar-and-deadlines.md`](case-calendar-and-deadlines.md) — where deadline items come from
- [`joining-magna-carta.md`](joining-magna-carta.md) — your account and the email address on it
