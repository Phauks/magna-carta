# Seeing What Version You Are On

The small chip at the top right of the screen always shows the version of Magna Carta you are running. Click it to see what version every part of the platform is on, and whether your firm's records are reachable from where you are sitting.

## What it does

The chip itself shows the web application's build identifier: a short code that pins exactly which build your browser loaded. It is always visible, even when the rest of the platform cannot be reached.

Clicking the chip opens the version overlay. It lists every Magna Carta worker under the name it is deployed as (`magna-carta`, `magna-carta-web`, `magna-carta-scan`, `magna-carta-convert`, and so on), with the version each one reports about itself. `magna-carta-web` is the worker that serves the screen you are looking at, so its line is your page's version. The list is the whole fleet: a worker that is not deployed in your environment, or that cannot be reached right now, still appears and says so plainly. The overlay never invents a version, and it never omits a worker.

Each reporting entry shows its build identifier, when that build's change was made, and when it was built.

The overlay has two sections, **Deployment** and **Database**, each behind a caret beside its heading. Both open by default and the overlay remembers whichever way you leave them, on this browser. A shut heading still carries anything wrong beneath it, so folding a section can hide rows but never hides a fault.

Under **Deployment**, the two workers that serve the application's address lead the list. Everything beneath them is grouped under **Workers**, which folds away behind a caret of its own. If any of the folded workers came back without a version, the shut heading says how many.

Under **Database**, the overlay checks the connection between your session and both of the databases behind it, and says what is standing in the way when something is — see [Checking the databases behind your session](#checking-the-databases-behind-your-session) below.

A line headed **This page** appears when nothing else in the list can state your page's version — before you sign in, when the read fails, or when `magna-carta-web` itself does not answer. It comes from the page itself rather than from the network, so it is there exactly when the network is not.

## When a new version ships

The application checks about once a minute whether a newer deployment has gone live. When one has, a small amber dot appears on the version chip, and opening it shows an **Update Available** notice. An amber reload symbol appears at the top of the overlay, beside the refresh control. Pressing it brings you onto the new version; until you do, the page you already loaded keeps working as it was.

## Before you sign in

The same chip sits in the top right of the sign-in page, the password-reset page and the registration screens, so you can answer "which version am I on" without getting in first. This matters most when getting in is the problem: you can quote the build identifier in a support request from the screen that is refusing you.

The signed-out overlay shows this page's build only, and says so. The deployment reports its versions to people who are signed in, and the databases can only be checked once there is a firm and an account to check them for, so before sign-in there is nothing to show for either. That is a boundary, not a fault: an absent list there does not mean anything is down. The new-version check still runs before sign-in, so the Update Available notice and its reload symbol can appear there too.

## Checking the databases behind your session

**Every screen you open uses two databases, not one.** Magna Carta's own database holds your account, your sign-in and the record of your firm itself; your firm's database holds everything your firm does — matters, files, time, trust, all of it. The platform's is consulted first, on the way to your firm's, so a screen that is slow or refusing can be either of them, and the two have different remedies. The overlay reports on both, in the same words, so you can say which one it is.

Your account also has to be written into your firm's database before the platform will let you do anything. Usually that happens within a minute or two of the firm being created, and nobody ever notices. When it has not happened yet — or when something between your browser and those records is not working — every screen you open refuses you, and the message it shows is about permissions: _"Your role does not grant this action in this firm."_ That message is accurate and unhelpful, because it looks like something an administrator forgot to do when usually it is something you only have to wait for.

The **Database** section of the version overlay is where that gets sorted out. It shows six things, in two groups of three — your firm's database first, then Magna Carta's own underneath it — each with its own state:

- **Firm database** — whether your firm's records answered this request, and how long they took. This is the connection itself.
- **Firm schema** — whether your firm's database has caught up with the version of Magna Carta you are running. A firm's database updates itself the next time it is used, so **Behind** is a wait rather than a fault, and it explains a screen that is missing something a newer version added.
- **Your membership** — whether your account has been written into the firm's records yet, which role or roles you hold, and how many things those roles permit. This is the row that explains a refusal.
- **Magna Carta database** — whether the platform's own records answered this request, and how long they took. Every screen consults these on its way to your firm's, so a slow or silent line here explains a slow screen that the firm rows above say nothing about.
- **Magna Carta schema** — whether the platform's own database has caught up with the version you are running. Like your firm's, it updates itself, so **Behind** here is a wait too.
- **File storage** — whether your firm's file storage has finished being set up. Until it has, an upload will not start; this is normal on a firm created minutes ago.

When a member record for your firm is still being written, or could not be written, a **Provisioning** line appears beneath the six rows and says which. "Still being written" is a wait and usually clears within a few minutes; "will not retry on its own" means somebody at Magna Carta has to release it, and is worth quoting in a support request.

The section is read when you open the overlay, and again whenever you press the refresh control at the top of it. Nothing is checked while the overlay is shut, so it never slows down the page you are working on.

If everything is in order, the **Database** heading carries no badge at all. If something needs waiting on it shows amber **Needs attention**, and if something is actually stopping you it shows red **Not working** — both of which stay on the heading even when the section is folded away.

## Common tasks

**Copy a version for a support request**

Click any version in the overlay. The full identifier line, including its dates, is copied to your clipboard, ready to paste into a message or bug report. The version you clicked darkens for a moment to confirm the copy happened; if nothing darkens, your browser refused the clipboard and nothing was copied.

**Get onto the newest version**

When the chip carries the amber dot, open it and press the amber reload symbol at the top. The page reloads onto whatever the platform is serving now.

**Shorten the list**

Press the caret beside **Deployment** or **Database** to fold that whole section away, or the one beside **Workers** to keep just the two workers that serve the application's address. The overlay opens the same way next time, on this browser.

**Find out why a screen is refusing you**

Open the chip and read the **Database** section. **Your membership** names the situation: _Not in the database yet_ is a wait, _No role_ is something an administrator can assign you, and _Active_ with a permission count means the refusal is about that particular screen rather than about your account. Press **Copy diagnosis** to put the whole reading on your clipboard for a support request.

**Compare the page against the server**

The page in your browser and the server answering it are delivered separately, so `magna-carta-web` and `magna-carta` are allowed to report different build identifiers. A badge beneath the two of them shows how they compare: green **In sync** once they match, amber **Web behind** when `magna-carta-web` is running the older build, and a neutral **Different builds** for any other difference — deploying separately means differing is often normal, so only "Web behind" is calling for anything. It appears only once both sides have reported a real version to compare. The signal that asks for action on your own page is the separate Update Available notice, which appears when a newer version of the page itself has shipped.

## Tips and edge cases

- **"Services checked … ago."** The deployment list is briefly cached, so an overlay opened inside that window says beneath its heading when the observation was actually taken. Pressing the refresh control asks every worker again right then, so the line starts over.
- **"Not deployed" / "Unreachable" / "Not reporting".** Three different facts, each stated under its row: the worker is not wired into this deployment, or it is wired but did not answer, or it is answering from a build too old to state its version. None of them is invented, and only "Unreachable" suggests something to chase.
- **"dev".** A build run outside the normal release pipeline (for example, a local development server) has no release identity, and the chip says `dev` rather than showing a number that would mean nothing.
- **"Not in the database yet".** Your account belongs to the firm — that is why you could sign in — but the firm's own records do not have it yet, so anything that checks a permission refuses. On a firm created minutes ago this is normal and clears itself; the **Provisioning** line beneath says whether it is still on its way.
- **The version read failed.** If the overlay cannot reach the server, it says so and shows the Error ID when one was assigned. Your page's own version comes back as the **This page** line, and the chip keeps showing it too: that part is baked into the page and needs no connection.

## Related features

- [`product-changelog.md`](product-changelog.md) — what changed between versions.
