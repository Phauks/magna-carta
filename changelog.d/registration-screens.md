---
category: Added
audience: internal
---

**The registration and invitation-redemption screens.** Joining is now something a visitor can do
from the app rather than only against the API: the **Register** link on the sign-in card opens the
three-way choice — a client at a law firm, someone who works at one, or someone starting a new one —
and the two invited doors both land on invitation redemption, because who belongs to a firm is that
firm's decision and never a stranger's. The founding door asks for the firm's name, then the
founder's own details, and sends one confirmation email; the screen that token is spent on reads it
out of the address bar as well as accepting it typed. The fork itself is settled in the browser: the
registration route answers the same constant for both invited doors, and spending a round trip and a
slice of the anonymous rate-limit budget to be told a constant would put the platform's front door
behind the API's availability.

**Redemption refuses as one.** The code, the last name and the date of birth are matched against a
single stored digest over all three, so the handler cannot know which was wrong — and the screen does
not pretend otherwise. One sentence, one alert, and all three fields carry the invalid mark together,
because the refusal belongs to the combination. The wording is a constant of the app's own rather
than an echo of the server's `detail`, so a change to the wording on the other side of the wire
cannot turn one answer into a per-field one, and a fitness test reads the screen and the page on
every run to keep it that way. What does vary is shown: the remaining attempts and the lockout
countdown render from the budget the server publishes, and stay absent when it publishes none.

**Every step says how far it carries.** A joining register sits beside the sign-in surface's register
of unbuilt capabilities, and the developer console's screen-state page renders both it and each new
screen in every state it can take. Two steps are marked as stopping short rather than shown as
working: the confirmation email carries a bare token and no link, so today the code has to be typed;
and neither the Terms of Service nor the Privacy Policy is published, so the two acknowledgements
gate the submit in the browser and are recorded nowhere. No credential is chosen while registering —
the password is set from the emailed link, which is the same act that proves the mailbox.

Dates on these screens are written out in full — `September 4, 2026, 14:03 PDT (UTC-07:00)`, never a
numeric date — because the one question a send time gets asked is whether the mail on screen is the
one this page just sent, and that should not need decoding.
