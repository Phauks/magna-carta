---
category: Added
---

The sign-in screen — the first real screen of the product, and the door everything else is behind.

**It asks for one thing at a time.** The screen opens asking only who you are; the password comes
next, on a card that shows the address you gave so a typo is visible before it costs an attempt.
Where an account carries an authenticator, the code is asked for after that. All three steps happen
at the same web address on purpose: a separate page for the code step would put "this account has
two-factor turned on" — and which step just failed — into the address bar, the browser history, and
anywhere that history is shared.

**A rejected sign-in never says which half was wrong.** "That email and password combination doesn't
match our records" is the whole answer, whether the address is unknown, the password is wrong, or the
account is not yet activated. Distinguishing those turns the front door into a way to test whether a
particular person works at the firm, one address at a time. An outage says something different —
it never implies you typed something wrong — and hitting a rate limit says that plainly instead of
claiming a valid code was bad.

**Nobody can give themselves an account.** There is no sign-up link and no registration path; the
card says so in as many words. Access is provisioned by the firm's administrator, and the only
side doors on the screen — reset a password, use a recovery code — lead to holding pages until those
flows are built, rather than to nothing.

**Staying signed in and trusting a device are two different choices, asked separately.** "Keep me
signed in on this device" is about this session; "Trust this device for 30 days" is about skipping
the authenticator next time. Both are real settings sent to the server, and the number of days in
that label is read from the configuration rather than written into the sentence, so the screen
cannot promise a window the server does not honour.

The code entry is a real one-time-code field: six cells that fill as you type, step back on
backspace, take a pasted code whole, and let a phone or password manager fill it in one go. Every
control on the screen is reachable and operable from the keyboard alone, announces its own state to a
screen reader, and carries a visible focus ring; the screen is drawn entirely from the design system,
so it is correct in both the light and dark settings without a second design.
