# Signed-in devices

Every computer, phone and browser that is signed in as you, listed in one place — so you can see whether anybody else is using your account, and end any session but the one you are on.

## What it does

**Account → Active Sessions** lists one row per live session. Each row says:

- **The device**, as far as the browser identifies itself — "Chrome on Windows", "Safari on iPhone". A browser that identifies itself as nothing recognisable is listed as an unrecognised device rather than guessed at.
- **This device**, on the row you are reading the screen on. That row has no Sign out button: ending the session you are using is signing out, and it lives in the profile menu at the top right.
- **When it was signed in**, **the address it signed in from**, and **when it expires on its own**.

A session appears here from the moment somebody signs in as you and disappears when it is signed out or expires. Ticking **Keep me signed in on this device** at sign-in is what makes a session long-lived; those are the rows most worth reviewing.

**What the list does not show is a "last used" time.** Magna Carta only knows when a session started, not the last minute it was active, and a stamp that looked like the second while meaning the first would be worse than none — you would clear a row that was in use, or leave one that was.

## Common tasks

**See who is signed in as you**

Select your initials at the top right, then **Account Settings**, then **Active Sessions** in the list on the left. The count above the list is the number of live sessions, including the one you are reading on.

**Sign out of one device**

Find its row and select **Sign out**. Use this when you know which one it is — a laptop you left at the office, a browser on a machine you no longer use.

**Sign out of everything except this one**

Select **Sign out everywhere else**, above the list. Every session but the one you are using ends. This is the right move when you are not sure what you are looking at: you do not have to identify the intruder, only keep yourself.

The button is unavailable when yours is the only session, because there would be nothing for it to do.

**Sign out of this device**

Not from this page — Account Settings has its own stripped header, with only the Magna Carta mark and a **Close** button. Select **Close** (the X, top right) to return to where you came from, then your initials at the top right, then **Sign out**. See [Signing in and out](signing-in.md).

## Tips and edge cases

- **A device you sign out here can take up to five minutes to be turned away.** It stops being able to sign in again immediately, but a request already on its way may still be answered for a few minutes. This is normal and the screen says so.
- **If you think somebody else has your account, reset your password as well.** Signing their device out is only half of it — a password they know lets them start a new session a moment later. Use **Forgot Password** on the sign-in screen: it emails you a reset link. (The **Password** row under **Account → Security** is not working yet, which is why the reset is the route to take.)
- **One person, several rows, is ordinary.** Your office computer, your laptop and your phone are three sessions, and signing in again on the same computer after a session expired makes a new row rather than reusing the old one.
- **An iPad usually shows as "Safari on macOS".** Recent iPads describe themselves to websites exactly as a Mac does, and Magna Carta would rather name the device vaguely than name it wrongly on a screen you are using to spot a stranger. Read the row alongside when it signed in and from where.
- **An address you do not recognise is worth a second look, not a panic.** Mobile networks and office connections change the address a session signed in from, so an unfamiliar one is not proof of anything on its own. Read it alongside the device and the time.
- **A row that will not go away** — if a sign-out reports that the device could not be signed out, it is still signed in. Try again, and if it keeps failing, reset your password and contact your firm's administrator.

## Related features

- [Signing in and out](signing-in.md) — the sign-in steps, staying signed in, and ending the session you are on.
- **Account → Security** is where your password and authenticator settings will live; both rows are marked *Soon* and do nothing yet. To change your password today, use **Forgot Password** on the sign-in screen.
