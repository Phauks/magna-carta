# Recording that a bill went out

> Backend built, screens pending: everything below works through the API today and the billing
> screens will surface it.

## What it does

Keeps a record of how and when each client got their bill, so you can always show that you gave it to
them.

**Magna Carta does not send the bill.** You do — you post it, hand it over, email it from your own
mailbox, or submit it to the client's e-billing portal — and then you tell Magna Carta what you did.
That is deliberate rather than a gap. Most bills go out by means the firm arranges itself, and what
matters when a fee is questioned is being able to show the client received the bill, not which system
carried it.

This becomes the answer to a question that comes up in two places: when a client says they never got
the bill, and when you are about to take earned fees out of a client's trust money, which in several
places you are expected not to do until the client has been given a bill or an accounting.

## Recording a delivery

Record it against a bill you have already finalized. A draft cannot be delivered — it is still being
written, and the client has not been given anything yet.

You give five things:

| Thing              | What it is                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------- |
| How it went        | Post, by hand, email, the client's e-billing portal, or the client portal                     |
| Who received it    | The address, mailbox, portal account, or the person you handed it to — in your own words       |
| The date           | The day it reached the client, which is usually **not** today                                  |
| A reference        | Optional: a tracking number, a submission reference, the message id of a mail you sent         |
| Whether it arrived | Delivered, or failed — a letter that came back, a dead address, a rejected submission          |

**The date is yours to state.** Record a delivery whenever you get round to it: a bill you posted last
Tuesday carries last Tuesday's date, not the date you typed it in. The only date that is refused is
one before the bill's own issue date, because that describes something that could not have happened.

**Say who received it, always.** A record that cannot say who got the bill does not answer the
question it exists for. Write what you actually know — "posted to the client's address of record",
"handed to Mrs Okafor at the closing meeting", "submitted to their e-billing portal".

## Sending a bill more than once

Each attempt is its own record. Nothing is overwritten.

That is what makes the history worth having. A letter that came back followed by a successful re-send
reads as exactly that — two records, one failed and one delivered — rather than as a single tidy
"sent" that hides the first attempt. A bill posted and then emailed as a courtesy is two deliveries
by two routes.

**Record the failures.** It is tempting to record only the attempts that worked, and it makes the
history worse: a bill you have chased three times without success looks identical to a bill you have
never sent, and those are very different situations to be in.

## Reading the history

Ask a bill for its deliveries and you get every attempt, oldest first, plus the summary:

- **Whether it ever arrived**, and the date it **first** arrived. First rather than most recent,
  because that is the date any deadline or expectation runs from — a courtesy re-send weeks later does
  not restart it.
- **How many attempts** there have been, and how many failed. This is what separates "never sent" from
  "sent repeatedly and never landed", which both read as not delivered.

A bill with no deliveries recorded says so plainly. That is a real answer, not a blank.

## Corrections

**A recorded delivery cannot be edited or deleted.** It is your evidence that you gave a client their
bill, and evidence that can be changed afterwards is not evidence — which is the same reason a
finalized bill and a credit note cannot be edited either.

The practical consequence: get the date and the recipient right when you record it. If you record
something wrong today, there is currently no way to walk it back, and how that should work is an open
question rather than a settled feature.

## Tips

- **Recording a delivery does not permit or prevent anything.** When you go to take fees out of a
  client's trust money, the bill tells you whether there is any record of the client having received
  it — and then the decision is yours. It is shown, never enforced. Enforcing it would only teach
  firms to tick a box.
- **A bill's delivery record shows up with the bill**, so you do not have to go looking for it before
  a decision that depends on it.
- **The client portal option is there for when the portal arrives.** Until then, a bill you put in
  front of a client through their own e-billing system is recorded as an e-billing submission.

## Related features

- Billing — drafting, reviewing, and finalizing bills.
- [Correcting a bill](correcting-a-bill.md) — credit notes, write-offs, and money the firm owes back.
- Trust accounting — taking earned fees against a finalized bill.
