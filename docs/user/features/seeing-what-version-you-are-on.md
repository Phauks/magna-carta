# Seeing What Version You Are On

The small chip at the top right of the screen always shows the version of Magna Carta you are running. Click it to see what version every part of the platform is on.

## What it does

The chip itself shows the web application's build identifier: a short code that pins exactly which build your browser loaded. It is always visible, even when the rest of the platform cannot be reached.

Clicking the chip opens the version overlay. It lists every Magna Carta worker under the name it is deployed as (`magna-carta`, `magna-carta-web`, `magna-carta-scan`, `magna-carta-convert`, and so on), with the version each one reports about itself. `magna-carta-web` is the worker that serves the screen you are looking at, so its line is your page's version. The list is the whole fleet: a worker that is not deployed in your environment, or that cannot be reached right now, still appears and says so plainly. The overlay never invents a version, and it never omits a worker.

Each reporting entry shows its build identifier, when that build's change was made, and when it was built.

The two workers that serve the application's address lead the list. Everything beneath them is grouped under **Workers**, which folds away behind the caret beside that heading; the overlay remembers whether you left it open or shut. If any of the folded workers came back without a version, the shut heading says how many, so folding the list can hide rows but never hides a fault.

A line headed **This page** appears when nothing else in the list can state your page's version — before you sign in, when the read fails, or when `magna-carta-web` itself does not answer. It comes from the page itself rather than from the network, so it is there exactly when the network is not.

## When a new version ships

The application checks about once a minute whether a newer deployment has gone live. When one has, a small amber dot appears on the version chip, and opening it shows an **Update Available** notice. An amber reload symbol appears at the top of the overlay, beside the refresh control. Pressing it brings you onto the new version; until you do, the page you already loaded keeps working as it was.

## Before you sign in

The same chip sits in the top right of the sign-in page, the password-reset page and the registration screens, so you can answer "which version am I on" without getting in first. This matters most when getting in is the problem: you can quote the build identifier in a support request from the screen that is refusing you.

The signed-out overlay shows this page's build only, and says so. The deployment reports its versions to people who are signed in, so before sign-in there is nothing to show for it. That is a boundary, not a fault: an absent list there does not mean anything is down. The new-version check still runs before sign-in, so the Update Available notice and its reload symbol can appear there too.

## Common tasks

**Copy a version for a support request**

Click any version in the overlay. The full identifier line, including its dates, is copied to your clipboard, ready to paste into a message or bug report. The version you clicked darkens for a moment to confirm the copy happened; if nothing darkens, your browser refused the clipboard and nothing was copied.

**Get onto the newest version**

When the chip carries the amber dot, open it and press the amber reload symbol at the top. The page reloads onto whatever the platform is serving now.

**Shorten the list**

Press the caret beside **Workers** to fold away everything except the two workers that serve the application's address. The overlay opens the same way next time, on this browser.

**Compare the page against the server**

The page in your browser and the server answering it are delivered separately, so `magna-carta-web` and `magna-carta` are allowed to report different build identifiers; the overlay says so beneath the two of them, and a difference on its own is not a problem. The signal that asks for action is the Update Available notice, which appears when a newer version of the page itself has shipped.

## Tips and edge cases

- **"Services checked … ago."** The deployment list is briefly cached, so an overlay opened inside that window says beneath its heading when the observation was actually taken. Pressing the refresh control asks every worker again right then, so the line starts over.
- **"Not deployed" / "Unreachable" / "Not reporting".** Three different facts, each stated under its row: the worker is not wired into this deployment, or it is wired but did not answer, or it is answering from a build too old to state its version. None of them is invented, and only "Unreachable" suggests something to chase.
- **"dev".** A build run outside the normal release pipeline (for example, a local development server) has no release identity, and the chip says `dev` rather than showing a number that would mean nothing.
- **The version read failed.** If the overlay cannot reach the server, it says so and shows the Error ID when one was assigned. Your page's own version comes back as the **This page** line, and the chip keeps showing it too: that part is baked into the page and needs no connection.

## Related features

- [`product-changelog.md`](product-changelog.md) — what changed between versions.
