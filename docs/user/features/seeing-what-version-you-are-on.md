# Seeing What Version You Are On

The small chip at the top right of the screen always shows the version of Magna Carta you are running. Click it to see what version is serving the app, which features are not working, and whether your firm's records are reachable from where you are sitting. The full report is the **System Status** page, opened from the pulse icon beside Customize at the foot of the sidebar, or from **Settings › Data & Platform** (the page that used to be called **Versions**; an old link still lands there). The chip is the quick view and the page is the full one. They never disagree, because they are one report read from the same places.

## The System Status page

The page answers "what works" before "what is running", because you use Outlook sync or address suggestions, not the services behind them.

Four counts sit across the top:

- **Features**: how many of the features this deployment can offer are working, and how many are not set up or not working.
- **Deployment**: whether the page in your browser and the server are on the same build.
- **Workers**: how many of the platform's services answered.
- **Errors**: how many failures the platform logged in the last 24 hours. Only platform operators see this count.

Under the counts, a tab answers each question:

- **Features and Workers** starts with the two workers every feature runs on, `magna-carta` and `magna-carta-web`, with the build each one is on and the change it came from. When the page and the server differ, it shows the changes between them. Below that is a table of every feature by area (Meetings and Calls, Calendar and Email, Files and Documents, Search and Lookups, AI, Platform), with one of three states. **Working** needs nothing. **Not set up** means nobody has turned the feature on for this deployment yet, which is a choice rather than a fault. **Not working** means it is turned on and something it depends on is not answering, which is worth reporting. Each feature lists what it runs on, one line each: the worker that does its work, with that worker's build and how long it took to answer, and each outside service it calls. A feature with neither runs inside `magna-carta` itself. Workers that no feature names, such as the status page's own worker, are listed under **Other Workers**, so the tab still covers the whole fleet. On a narrow screen the table becomes one card per feature.
- **This Firm** is the check on your firm's own records, described in [Checking your firm's database](#checking-your-firms-database).
- **Recent Errors** lists the platform's failures over the last day, one row per kind of failure, with how many times it happened, when it was first and last seen, and the newest Error ID. At the top, **Look up an Error ID** takes any `error_` or `client_` reference a member quotes and shows what it was: the request or screen, the answer, the cause, the time, and the firm and member it happened to (as identifiers). Records are kept for 30 days. This tab appears only for platform operators, because the rows cover every firm on the deployment.
- **Feature Flags** lists the flags your firm's release channel switches on or off, and marks any that differ from their default.

### Outside services

An outside service is an API somebody else runs, such as Cloudflare Realtime for meetings, Google Calendar, or Telnyx for caller ID. Its line says one of these:

- **Connected**: the service accepted this deployment's key just now. This appears only where checking is free.
- **Refused the key** or **Not answering**: the check ran and failed, so the feature will not work until the key or the service is fixed.
- **Key set**: the key is in place, but the service was not asked, because each call to it is billed or there is no free way to check. The line says which.
- **Not set up**: the key is missing. Password recovery's line for GPU compute (for slow passwords) reads this way until a GPU provider is connected.

### For platform operators

A platform operator sees more on the **Features and Workers** tab. A feature that is not set up names the settings it still needs and opens to a short list of steps that turn it on, with a link to the full steps in the deployment guide. A feature that is not working offers a link to the service in the hosting console. The page only ever says whether a setting is present. It never shows a setting's value to anyone.

The **Recent Errors** tab shows failed requests and app crashes without any setup. Failures in the platform's background work (scheduled passes and queues) come from the hosting provider's logs, which need one read-only token. Until it is set, the tab says background failures are not shown, and **Background errors** appears as a not-set-up row on the Features and Workers tab with the steps to add it.

## What it does

The chip itself shows the web application's build identifier: a short code that pins exactly which build your browser loaded. It is always visible, even when the rest of the platform cannot be reached.

Beside the identifier, the chip carries a badge naming the kind of build you are on — **Development**, or the name of a preview environment — whenever you are not on the live site. There is no badge on the live site: that is the ordinary case, and a badge that said so on every screen would be telling you nothing.

## The chip

Clicking the chip opens the version overlay. It is deliberately short: the build that is serving the app, any feature that is not working, and your firm's records. The **System Status** button at the bottom opens the full page.

On the page, the **Features and Workers** tab lists every Magna Carta worker under the name it is deployed as (`magna-carta`, `magna-carta-web`, `magna-carta-scan`, `magna-carta-convert`, and so on), with the version each one reports about itself. `magna-carta-web` is the worker that serves the screen you are looking at, so its line is your page's version. The list is the whole fleet: a worker that is not deployed in your environment, or that cannot be reached right now, still appears and says so plainly. The overlay never invents a version, and it never omits a worker.

Each reporting entry shows its build identifier, when that build's change was made, when it was built, and how long it took to answer. A worker that is answering but taking a long time about it is marked **Slow** — it is still working, and it is the one thing here worth watching before it stops.

Worker names are links: opening one takes you to that worker in the platform's own hosting console. That console belongs to Magna Carta rather than to your firm, so the link is there for the people who run the platform; nothing in the overlay needs it.

The symbol at the end of the row of controls at the top opens the source the build on screen was made from. Like the worker links, it is there for the people who run the platform: the overlay answers every question about which version you are on without it.

The overlay has three sections, **Deployment**, **Features** and **Database**, each behind a caret beside its heading. **Features** names only the features that are not working, as **Not available yet** or **Not working**, and says **Every feature is working.** when there are none. Both open by default and the overlay remembers whichever way you leave them, on this browser. A shut heading still carries anything wrong beneath it, so folding a section can hide rows but never hides a fault — and if one of the overlay's own readings failed, it says so whether the section is folded or not.

Under **Deployment**, the two workers that serve the application's address lead the list. The rest of the fleet is on the page's **Features and Workers** tab, beside the features each worker powers.

Under **Database** (the **This Firm** tab on the page), the overlay checks the connection between your session and your firm's own records, and says what is standing between the two when something is — see [Checking your firm's database](#checking-your-firms-database) below.

A line headed **This page** appears when nothing else in the list can state your page's version — before you sign in, when the read fails, or when `magna-carta-web` itself does not answer. It comes from the page itself rather than from the network, so it is there exactly when the network is not.

## The About window

Choose **About Magna Carta** under **Websites** in your profile menu (or search for it) to open a short summary of the copy you are using: its version and release date, who you are signed in as and which firm, the kind of build, and your browser. **Copy Version Details** puts all of those on your clipboard as plain lines, ready to paste into a support request.

The right side of the window links to the **Changelog**, **System Status** (the page described above), **Service status** and **Report an issue**. Documentation and the legal pages are listed as **Soon** until they are published.

## When a new version ships

The application checks about once a minute whether a newer deployment has gone live. When one has, a small amber dot appears on the version chip, and opening it shows an **Update Available** notice. An amber reload symbol appears at the top of the overlay, beside the refresh control. Pressing it brings you onto the new version; until you do, the page you already loaded keeps working as it was.

Once the platform has reported which build it is now serving, a **What changed** button appears under the notice and opens the list of changes between the version you are running and the one waiting for you.

## Before you sign in

The same chip sits in the top right of the sign-in page, the password-reset page and the registration screens, so you can answer "which version am I on" without getting in first. This matters most when getting in is the problem: you can quote the build identifier in a support request from the screen that is refusing you.

The signed-out overlay shows this page's build only, and says so. The deployment reports its versions to people who are signed in, and a firm's database can only be checked once there is a firm to check, so before sign-in there is nothing to show for either. That is a boundary, not a fault: an absent list there does not mean anything is down. The new-version check still runs before sign-in, so the Update Available notice and its reload symbol can appear there too.

## Checking your firm's database

Your firm's records live in a database of their own, and your account has to be written into it before the platform will let you do anything. Usually that happens within a minute or two of the firm being created, and nobody ever notices. When it has not happened yet — or when something between your browser and those records is not working — every screen you open refuses you, and the message it shows is about permissions: _"Your role does not grant this action in this firm."_ That message is accurate and unhelpful, because it looks like something an administrator forgot to do when usually it is something you only have to wait for.

The **Database** section of the version overlay is where that gets sorted out. It shows five things, each with its own state:

- **Firm database** — whether your firm's records answered this request, and how long they took. This is the connection itself.
- **Schema** — whether your firm's database has caught up with the version of Magna Carta you are running. A firm's database updates itself the next time it is used, so **Behind** is a wait rather than a fault, and it explains a screen that is missing something a newer version added.
- **Your membership** — whether your account has been written into the firm's records yet, which role or roles you hold, and how many things those roles permit. This is the row that explains a refusal.
- **Control plane** — whether the platform's own records answered, and whether your firm's file storage has finished being set up.
- **File storage** — which way an uploaded file travels (straight from your browser to the firm's storage, or through the application), and what the last upload readiness check found. **Not yet checked** is a fact rather than a fault: nobody has run the check. For an administrator the check runs when the System Status page opens, and the **This Firm** tab lists every check on its own line under **Upload readiness**. **Not ready** names the first thing the check found missing — see [Checking that uploads can reach the firm's storage](../admin/upload-readiness.md).

When a member record for your firm is still being written, or could not be written, a **Provisioning** line appears beneath the four rows and says which. "Still being written" is a wait and usually clears within a few minutes; "will not retry on its own" means somebody at Magna Carta has to release it, and is worth quoting in a support request.

The section is read when you open the overlay, and again whenever you press the refresh control at the top of it. Nothing is checked while the overlay is shut, so it never slows down the page you are working on.

If everything is in order, the **Database** heading carries no badge at all. If something needs waiting on it shows amber **Needs attention**, and if something is actually stopping you it shows red **Not working** — both of which stay on the heading even when the section is folded away.

## Common tasks

**Copy a version for a support request**

Click any version in the overlay. The full identifier line, including its dates, is copied to your clipboard, ready to paste into a message or bug report. The version you clicked darkens for a moment to confirm the copy happened.

Some browsers refuse to let a page use the clipboard at all — a strict privacy setting, or a policy your firm's IT has applied. When that happens the overlay says so in as many words rather than leaving you to discover it when you paste, and you can select the text and copy it by hand instead.

**Copy everything the overlay is showing**

The copy symbol at the top of the overlay puts the whole reading on your clipboard at once: your page's build, every worker and what it reported, your firm's database, the upload checks, and your browser's own details. Anything that failed to load is in there too, with the Error ID it was given — those are the lines support most needs, and they are exactly the ones a half-loaded overlay used to leave out.

**Report a problem from here**

The speech-bubble symbol at the top of the overlay opens the usual issue report with all of that already attached, so you can describe what happened without copying or pasting anything. The report goes to Magna Carta's own reporting pipeline, never to a third party. The overlay closes as the report opens, so the report has the screen to itself; closing the report without sending it keeps what you have written, and opening it again from anywhere — here, the profile menu, or the command menu — brings the same draft back.

**Get onto the newest version**

When the chip carries the amber dot, open it and press the amber reload symbol at the top. The page reloads onto whatever the platform is serving now.

**Shorten the list**

Press the caret beside **Deployment**, **Features** or **Database** to fold that whole section away. The overlay opens the same way next time, on this browser.

**Open the overlay without reaching for the mouse**

Open the command menu (Ctrl+K, or Cmd+K on a Mac) and type "build" — or "version", "commit" or "system status". **Build Information** is in the results under **Diagnostics**.

**Find out why a screen is refusing you**

Open the chip and read the **Database** section. **Your membership** names the situation: _Not in the database yet_ is a wait, _No role_ is something an administrator can assign you, and _Active_ with a permission count means the refusal is about that particular screen rather than about your account. Press the copy symbol at the top of the overlay to put the whole reading on your clipboard for a support request, or the speech-bubble symbol to file it directly.

**Compare the page against the server**

The page in your browser and the server answering it are delivered separately, so `magna-carta-web` and `magna-carta` are allowed to report different build identifiers. A badge beneath the two of them shows how they compare: green **In sync** once they match, amber **Web behind** when `magna-carta-web` is running the older build, and a neutral **Different builds** for any other difference — deploying separately means differing is often normal, so only "Web behind" is calling for anything. It appears only once both sides have reported a real version to compare. The signal that asks for action on your own page is the separate Update Available notice, which appears when a newer version of the page itself has shipped.

## Tips and edge cases

- **"Services checked … ago."** The deployment list is briefly cached, so an overlay opened inside that window says beneath its heading when the observation was actually taken. Pressing the refresh control asks every worker again right then, so the line starts over.
- **"Not deployed" / "Unreachable" / "Not reporting".** Three different facts, each stated under its row: the worker is not wired into this deployment, or it is wired but did not answer, or it is answering from a build too old to state its version. None of them is invented, and only "Unreachable" suggests something to chase.
- **"dev".** A build run outside the normal release pipeline (for example, a local development server) has no release identity, and the chip says `dev` rather than showing a number that would mean nothing.
- **"Not in the database yet".** Your account belongs to the firm — that is why you could sign in — but the firm's own records do not have it yet, so anything that checks a permission refuses. On a firm created minutes ago this is normal and clears itself; the **Provisioning** line beneath says whether it is still on its way.
- **The version read failed.** If the overlay cannot reach the server, it says so and shows the Error ID when one was assigned — on the screen, and in anything you copy or file from here. Your page's own version comes back as the **This page** line, and the chip keeps showing it too: that part is baked into the page and needs no connection.

## Related features

- [`product-changelog.md`](product-changelog.md) — what changed between versions.
