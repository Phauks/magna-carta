---
category: Added
---

**Design: who may release money from a client's trust ledger, and who a payment waits for.** The
owner's direction is that a member with the authority to approve trust payments can make one on
their own, and a member without that authority sends the payment to somebody who has it. Above an
amount the firm chooses, even a member with authority needs a second person, and a firm can require
that second person to hold the authority too. A firm with only one such member is not locked out of
paying its clients' money out.

The design settles how that is expressed without changing the record-keeping the platform already
does. Nothing new is stored: the posture a firm already sets — whether payments take two people,
above what amount, and whether whoever releases the money must hold the authority to act — already
says all of it, and the firm's own settings page will name the resulting postures in plain words.
Every firm now starts on the authority-based posture as a visible, dated entry in its own history of
posture changes, rather than as an unwritten default, and a firm that wants a ceiling or wants every
payment reviewed writes that change the same way it always would. A payment already waiting for a
decision keeps the rules it was submitted under, in both directions, exactly as before.

No behaviour ships in this change: it is the design and the decision record. The build slice that
follows adds the seeded starting posture, teaches the payment and earned-fee screens to send a
payment for approval instead of refusing it, and states on each approval — in the client ledger and
in the audit trail — whether it was released alone, approved by a second person, or approved under
the sole-authorizer exception.
