# When something goes wrong

## What it does

Tells you what actually happened, gives you a reference you can quote, and — where there is one —
offers the one control that gets you moving again.

Every failure in Magna Carta looks the same wherever it happens, because it is the same thing
underneath. What changes is how much of the screen it takes:

| What failed      | What you see                                                                |
| ---------------- | --------------------------------------------------------------------------- |
| One action       | A line where you were working. The rest of the screen keeps going.          |
| One panel        | That panel says why. Its heading stays, so you do not lose your place.      |
| The whole screen | The body says why. The sidebar and tabs stay live — you are never stranded. |
| The app itself   | A plain screen with a reference and a way to reload.                        |

## What failed, in one line

Every failure leads with a short line naming three things:

- **the area** of Magna Carta it happened in, such as Meetings or Trust
- **the action** that failed, such as Join meeting or Change matter
- **the kind of failure**: a fault on our side (with its technical name, such as TypeError), a refusal
  (with the answer the service gave), no answer at all, or a fault in the app on your screen

That line is usually enough to tell anyone helping you what went wrong. **Show details** opens the
rest: the request, the service's answer, the cause, the time and the Error ID. **Copy details** is
always beside it. A failure that appears as a short pop-up message has the same line under its
message, and a **Copy details** button.

## The first thing it tells you

Whether your record survived. A panel that will not load does not mean anything has been lost, and
the screen says so before it says anything else — because "the costs could not be read" and "the
costs are gone" are very different mornings, and only one of them is true.

Nothing that fails to load has changed anything. A read that fails is a read that failed.

## The Error ID

Every failure carries one, under **Show details**. It looks like `error_0mwfnax8napiSlVeIBqj4`, and
it is how we find your exact failure in our records rather than guessing from a description. Magna
Carta keeps a record of each one for 30 days, so it can be looked up by the people who run your
deployment.

Sometimes the reference begins `client_` instead. That means the failure happened in the app on your
screen rather than in the service. When you are signed in, the app sends the technical facts of that
failure (never anything you typed or any record's contents) so the reference can be looked up too.
The same is true for a guest you invited to a meeting: a failure on their page is kept against their
reference through their own meeting link, without the link itself.

## Copy details

One press puts everything we would otherwise have to ask you for onto the clipboard:

- which version of Magna Carta you were using, and which page you were on
- which request failed and what the service answered
- when it failed, and when you copied it
- your browser, screen size, language, time zone, and whether you had a connection
- the last few things you did in the app before it went wrong

That last one records **what** you did, never what you typed — a page you opened, a button you
pressed. No document name, client name, matter content or field value is ever in it.

If your browser will not let us use the clipboard — this happens on some managed devices — the block
says so and stays selectable, so you can take it by hand. It will never tell you it copied when it
did not.

## Report a Problem

You do not need something to be broken in front of you. **Report a Problem** is in your profile menu
and in the command palette on every screen, and it is also offered on every failure.

A report takes two steps:

1. **Describe.** Say what happened in your own words, then press **Next**.
2. **Screenshot.** You see a picture of the screen you were on, taken when you opened the report
   (the report window itself is not in it). Drag over anything private, such as a client's name, to
   cover it; **Undo** takes the last cover off. Covered parts are blacked out on your computer before
   anything is sent, so they never leave it. Untick **Send this screenshot** to send the report
   without a picture, or press **Back** to change your words.

The report carries your description, the screenshot if you send it, the Error ID if there was one,
the page, the version and the recent-actions list, and nothing else. Your firm's admins read it.
Unless your firm has turned it off, Magna Carta reads it too, so the problem can be fixed; the report
window says which. You get a reference back; quoting it gets support straight to your report.

## Hearing back

You get a notification when your report arrives, and another each time its status changes:
**Received**, **Looking Into It**, **Fixed** or **Closed**. Whoever answered may leave a note; it is
not in the notification or the email, so open the report to read it.

All your reports are under **Settings › My Settings › My Reports**: your words, your screenshot, the
status and any note.

## What the controls mean

A failure only offers a control that would actually do something. If you see nothing to press, there
is nothing pressing would fix — copy the details and report it. A clash with the state a record is in
(a cost already on a finalized bill, a hold in force) offers no Retry, because it would only be refused
again; a clash that clears by itself (the same request still running, a set that changed while you
worked) does.

| Control              | Means                                                                    |
| -------------------- | ------------------------------------------------------------------------ |
| **Retry**            | It may well work now. Interruptions usually clear on the next attempt.   |
| **Retry in 47s**     | You have tried several times quickly. Nothing you sent was wrong.        |
| **Sign in again**    | Your session ended. You will come back to the page you were on.          |
| **Confirm identity** | This action needs a fresh sign-in — moving client money, most often.     |
| **Request access**   | The record is restricted, and you can ask the person responsible for it. |
| **Report a problem** | Always available. It files; it does not just copy.                       |

## Two messages worth recognising

**"The service is mid-update."** We had just released an update, and the page you had open was
briefly a version ahead of the service behind it. Reload and they line up. Nothing is wrong with what
you did, and nothing you saved is affected.

**"Several reads are failing."** More than one part of the screen failed at once, so the trouble is
ours rather than any one panel's. This appears once at the top of the screen rather than on every
panel, with a link to the service status page.

## What we never do

- Send anything to a third-party error service. Reports go to your firm's admins and, unless your
  firm has turned it off, to Magna Carta. Nobody else.
- Put your document names, client names, matter content or field values in a report.
- Send a report you did not ask us to send. A crash offers to file one; it never files itself. (The
  technical record behind an Error ID is kept automatically, but it holds only the code-level facts
  listed above and nothing you wrote.)
