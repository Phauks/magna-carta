# Seeing What Version You Are On

The small chip at the top right of the screen always shows the version of Magna Carta you are running. Click it to see what version every part of the platform is on.

## What it does

The chip itself shows the web application's build identifier: a short code that pins exactly which build your browser loaded. It is always visible, even when the rest of the platform cannot be reached.

Clicking the chip opens the version overlay, which lists every part of the deployment:

- **Web App** — the application running in your browser.
- **API** — the server the application talks to.
- **Services** — each backend service (malware scanning, conversion engines, text recognition, document sealing, discovery, keyword search, and the others), with the version each one reports about itself.

Each entry shows its build identifier, when that build's change was made, and when it was built. A service that is not deployed in your environment, or that cannot be reached right now, says so plainly: the overlay never invents a version.

## Before you sign in

The same chip sits in the top right of the sign-in page, the password-reset page and the registration screens, so you can answer "which version am I on" without getting in first. This matters most when getting in is the problem: you can quote the build identifier in a support request from the screen that is refusing you.

The signed-out overlay shows the web application only, and says so. The API and the backend services report their versions to people who are signed in, so before sign-in there is nothing to show for them. That is a boundary, not a fault: an empty list there does not mean anything is down.

## Common tasks

**Copy a version for a support request**

Click any version in the overlay. The full identifier line, including its dates, is copied to your clipboard, ready to paste into a message or bug report.

**Check whether the web app and the API match**

The web application and the server deploy separately, so for a short window they can be on different builds. When both report a real build and the two differ, the overlay says so with a "Different Builds" notice. If you see something behaving oddly right after an update, this is worth checking: reloading the page usually brings the web app up to date.

## Tips and edge cases

- **"Checked … ago."** The service list is refreshed on a short cycle rather than on every click. When the overlay is showing an observation more than a few seconds old, the header says when it was taken.
- **"dev".** A build run outside the normal release pipeline (for example, a local development server) has no release identity, and the chip says `dev` rather than showing a number that would mean nothing.
- **The version read failed.** If the overlay cannot reach the server, it says so and shows the Error ID when one was assigned. The chip itself keeps showing your web app's own version: that part is baked into the page and needs no connection.
- **No "Different Builds" notice before you sign in.** The signed-out overlay has no version to compare yours against, so it never raises the notice. Sign in and open the chip again to check the pair.

## Related features

- [`product-changelog.md`](product-changelog.md) — what changed between versions.
