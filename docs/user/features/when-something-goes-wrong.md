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

## The first thing it tells you

Whether your record survived. A panel that will not load does not mean anything has been lost, and
the screen says so before it says anything else — because "the costs could not be read" and "the
costs are gone" are very different mornings, and only one of them is true.

Nothing that fails to load has changed anything. A read that fails is a read that failed.

## The Error ID

Every failure carries one. It looks like `error_7FQ2K9XW`, and it is how we find your exact failure
in our records rather than guessing from a description.

Press it to copy it. If you would rather not transcribe it, use **Copy details** instead — that puts
the whole picture on your clipboard.

Occasionally you will see a reference beginning `client_` instead. That means the failure happened
in your browser and never reached us, so there is nothing on our side to look up yet. Send it anyway:
it still identifies your report.

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

Say what happened in your own words. The report carries your description, the Error ID if there was
one, the page, the version and the recent-actions list — and nothing else. It goes to your firm's own
reporting pipeline, not to an outside service. You get a reference back; quoting it gets support
straight to your report.

## What the controls mean

A failure only offers a control that would actually do something. If you see nothing to press, there
is nothing pressing would fix — copy the details and report it.

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

- Send anything to a third-party error service. Reports go to your firm's pipeline and stop there.
- Put your document names, client names, matter content or field values in a report.
- Send a report you did not ask us to send. A crash offers to file one; it never files itself.
