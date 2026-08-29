---
category: Added
audience: public
---

**A version chip at the top right of every signed-in screen, and an overlay that says what every
part of the platform is running.** The chip is the web application's own build identifier, baked in
at build time, so it renders even when nothing else answers. Clicking it opens the version overlay:
the web app, the API, and each backend service worker (malware scan, bundle build, conversion,
file repair, password recovery, text recognition, document sealing, discovery, keyword search) with
its commit, commit date, build time, and reachability. Every value is copyable in one click.

The overlay is honest by construction. Each service reports its own identity over a tiny shared
version route (`packages/build-identity`, stamped by each Worker's deploy build; a build without
git identity says `dev`); a service that is absent, unreachable, or too old to answer is named as
exactly that, never given an invented version. The aggregate read
(`GET /api/v1/meta/versions`) probes all bindings in parallel under short timeouts, caches
briefly, and carries `observedAt` so a cached answer states its age. And because the web app and
the API deploy separately, the one skew that matters is called out in words: when their commits
differ, the overlay says "Different Builds".

## Public

**You can now always see what version of Magna Carta you are on.** A small chip at the top right
of every signed-in screen shows the web application's build. Click it to open the version overlay:
the web app, the server, and each backend service, each with its build, when it was made, and
whether it is reachable, and any value copies to your clipboard in one click for a support
request. When the web app and the server are briefly on different builds after an update, the
overlay says so plainly.
