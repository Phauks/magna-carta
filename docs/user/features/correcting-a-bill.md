# Correcting a bill

> Backend built, screens pending: everything below works through the API today and the billing
> screens will surface it.

## What it does

Puts right a bill that has already gone out, without pretending it never did. A finalized bill
cannot be edited, un-finalized, or deleted — so every correction here is a second record that stands
beside it. Between them they tell the true story: what the client was told, and what changed
afterwards.

Four things you can do, and they mean four different things:

| You want to                                        | Use              | It says                                                     |
| -------------------------------------------------- | ---------------- | ----------------------------------------------------------- |
| Take something off a bill you should not have charged | A credit note    | The charge was wrong                                        |
| Give up chasing money you are still owed           | A write-off      | The charge was right; the money is not coming               |
| Give a client back money they have already paid    | A client credit  | The firm is holding money it has conceded is not its own    |
| Undo value recorded against the wrong bill         | A reversal       | The bill is fine; the payment landed in the wrong place     |

## Issuing a credit note

Write it against the bill it corrects. Give the reason in your own words — it is read years later
by whoever is reconstructing a fee dispute, and no dropdown would say what you can. Then list what
you are taking off, one line at a time, each naming its matter and what it credits.

**Where the credit lands depends on what is still unpaid.** If the client has not paid the bill, the
credit comes straight off what they owe. If they have paid all or part of it, the money is already
in the firm's account, so the part the bill can no longer absorb becomes a **client credit** — a
recorded amount the firm owes back. Nothing is quietly netted off and nothing goes negative.

**If you are correcting one specific charge, say which one.** Picking the line you are crediting
matters for fees worked out from a settlement or a recovery: those are billed as the increment over
what earlier bills already charged, so a credit only changes the arithmetic if the platform knows
which charge it applies to. A general goodwill credit against the same bill deliberately does not.

A credit note cannot be edited or withdrawn once issued. If one was wrong, issue another.

## Writing off a balance

Write off part or all of what a matter still owes on a bill, with the reason. It is kept separate
from a credit note on the firm's books on purpose: your accountant needs to see what the firm billed
and gave up as bad debt separately from what it conceded it should never have charged. You cannot
write off more than is still owed — money already collected is refunded or credited instead.

A write-off is also the lawful way to close a matter carrying a bill nobody is going to pay.

## Giving a client credit back

An open credit is money the firm is holding that it has said is not its own, so it does not go away
by itself and a matter will not close while one is open. You have three ways to discharge it:

1. **Refund it** from the firm's operating account.
2. **Return it** to the client's trust ledger.
3. **Set it against a later bill** for the same client — any of their matters, not only the one the
   credit arose on.

The platform performs the third: setting a credit against a later bill discharges that much of the
obligation and no money moves in either direction. The first two move real money out of a firm
account, and the platform does not do them on your behalf — record the payment through your usual
route and the credit stays visible until it is settled. Which of the three is right depends on what
you have agreed with the client, and it is your decision to make.

You can set part of a credit against one bill and the rest against another. You can never set one
client's credit against another client's bill.

## Undoing an application

If a payment or a credit was recorded against the wrong bill or the wrong matter, reverse it. The
original record stays exactly as it was and the reversal is a new record linked to it, so both are
readable afterwards, and a reversal can only happen once.

Two things cannot be reversed here. **A transfer out of a client's trust account** — putting client
money back is a movement in the trust ledger and is raised and authorized there, not from the
billing screen. **A credit note** — the client may already be holding it, so it is answered by a
further correction rather than by quietly unwinding what it did.

## When a settlement collapses after you have billed the fee

This is the case worth knowing about. You record a settlement, bill your contingency share, and send
the bill. Then the settlement falls through, or is reduced, or a case cost you advanced arrives late
under a net-of-costs agreement. The recovery your fee was a share of has shrunk, and the bill saying
otherwise has already gone to the client.

The bill was true when you issued it and it cannot be edited. So ask the matter for its
**contingency position**: it compares what you have actually billed against what the surviving
recovery now entitles you to, and reports the difference. It also names each finalized fee line and
what that bill still owes, because a correction larger than the unpaid balance leaves the firm
owing the client money back rather than simply reducing a debt.

Nothing is issued for you. What a client is owed after a settlement collapses is your decision, and
it may not be the whole difference. When you do issue the credit note, name the fee line it credits
— then the difference resolves, the matter stops being reported, and a later recovery on the same
matter bills its own increment against the corrected figure rather than the one you gave back.

## Tips

- **Nothing here changes the bill.** The document the client received keeps its number, its lines,
  and its wording forever. Only what is owed on it moves.
- **A correction needs the account map set up.** Credit notes, write-offs, and client credits each
  post to their own account on the firm's books, so those roles have to be mapped in billing
  configuration before the first one can be issued. The refusal names the missing role.
- **A credit note dated in the future is refused**, like any other posting.

## Related features

- Billing — drafting, reviewing, and finalizing invoices.
- Fee arrangements — hourly, flat fee, contingency, and retainer, and how each is billed.
- Trust accounting — deposits, holds, and taking earned fees against a finalized bill.
