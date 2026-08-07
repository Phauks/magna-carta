# Trust money-out approvals: your firm's policy

Money leaving a client's trust ledger — a payment to a court, a vendor, or the client, and equally
your own earned fees taken against a finalized bill — can require a second person's approval. How
much of that protection your firm wants is your choice.

## The three postures

- **Always** (the default): every payment out of a client ledger, whatever the amount, must be
  proposed by one member and approved by another.
- **Above a threshold**: payments at or below an amount you set can be completed by the member who
  proposed them; anything above it takes a second person.
- **Off**: any member who can move trust money can complete their own payment.

Every firm starts on **Always**. Nothing about your controls changes unless someone with the
authority to do so changes them deliberately.

## The authority option

Independently of the postures above, you can require that whoever completes a payment — the second
approver, or the sole member when your posture allows acting alone — holds the **authority to act on
client money**. That authority is the `trust:authorize` capability: Owner/Admin and Attorney roles
carry it out of the box, and you can grant it to (or remove it from) anyone, so "who counts as
having authority" is exactly who your firm says it is.

## How approvals work day to day

1. A member proposes the payment: the amount, the payee, the purpose, the method. Nothing moves —
   the client ledger is untouched while a proposal is pending.
2. Pending proposals sit in one queue per trust account, oldest first. Earned-fee applications
   appear in the same queue, labelled as such, so one review covers every way money leaves.
3. A second member approves, rejects (with a reason the proposer can answer), or the proposer
   withdraws their own request. Approval is the moment the money actually moves, and everything is
   checked again right then — if the ledger no longer has the funds available, or a bill has been
   paid down in the meantime, the approval is refused rather than posted.

If your firm has only one member who can move trust money at all, that member can complete their own
payments — and the record says so explicitly, so the exception is always visible.

## Changing the policy

Changing the posture requires the authority capability, and every change is recorded permanently:
who changed it, when, and what it was before. A change applies to **new** proposals only — anything
already awaiting approval is decided under the rules that were in force when it was proposed, so
relaxing the policy never quietly unlocks a payment that was proposed under the stricter one.
