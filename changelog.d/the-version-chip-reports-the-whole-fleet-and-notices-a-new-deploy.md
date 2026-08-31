---
category: Changed
audience: public
---

**The version chip reports the whole fleet, names every row by its deployed Worker, and tells you
when a newer deployment is live.**

The Build Versions panel's roster was eight workers short of the fleet and its rows carried invented
product names ("Malware Scan") beside, or instead of, the thing an operator would actually open.
Four changes, one panel:

- **Every magna-carta worker is listed.** The aggregate's roster is now the whole fleet — the edit,
  email, status and web workers join it — and a fitness test pins the roster to the wrangler configs
  on disk, so a worker added under `apps/` cannot silently stay off the overlay. The edit and status
  workers now mount the shared version route (and stamp their builds), the email worker gains a
  version-only `fetch` surface for the day it deploys, and the assets-only web worker answers
  through a static `/__version` file its build emits.
- **One name per line, and it is the real one.** Each deployment row is headed by the Cloudflare
  Worker it reports on, carried on the wire itself (`service` replaces `label` in
  `GET /api/v1/meta/versions`), with its state sentence beneath. The web app's own line stops
  borrowing the `magna-carta` name: the build the browser is running is its own line ("This page"),
  separate from the deployment list.
- **A newer deployment announces itself.** The app polls its own version (each build is named by
  its commit) and when a newer bundle is live the chip carries a warning dot and the panel leads
  with the notice and a Reload control. The page-versus-API skew check remains as the second
  detector.
- **Refresh means now.** The panel's Refresh and Retry pass `fresh=true`, which skips the server's
  brief cache and re-probes every worker — so the "checked N seconds ago" line starts over instead
  of climbing through a cache window.

## Public

The version overlay (the small chip at the top right) now lists every part of the platform, each
under the name it is deployed as, and never leaves one out: a part that is not deployed or not
answering says so plainly instead of disappearing from the list. Your own page gets its own line,
"This page", separate from the deployment list. Magna Carta also now notices when a newer version
has shipped while you have the app open: the chip shows a small amber dot, and opening it offers an
Update Available notice with a Reload button. Pressing the overlay's refresh control asks every part
again right then, so the "checked … ago" line starts over.
