---
category: Added
audience: public
---

**The version chip now sits on the sign-in page too.** It only existed inside the application, which
put it on the wrong side of the door: "which version am I on" is asked most often by someone who
cannot get in, and the one screen they can reach could not answer.

The chip and its overlay ride the shared signed-out frame, so sign in, password reset and the
registration screens all carry it in the same chrome corner, from the same component as the app
shell's. Its identifier is baked into the page at build time, so it needs no connection and no
session to be right.

The signed-out overlay shows the web application alone and says so in a line of its own. The
aggregate that reports the API and the backend services is an authenticated read, and is not
attempted before sign-in: a signed-out panel issues no request at all rather than rendering a
rejection as though something were down. The skew notice, which needs a second version to compare
against, is likewise absent there rather than guessed at.

## Public

**You can now see which version you are on before you sign in.** The version chip has moved into the
top right of the sign-in page, the password-reset page and the registration screens, so you can read
your build identifier, and copy it into a support request, from the screen that is refusing you.

Signed out, the overlay shows the web application only, and says so. The API and the backend
services report their versions once you are signed in, so nothing is missing there and nothing is
wrong: sign in and open the chip again for the full picture.
