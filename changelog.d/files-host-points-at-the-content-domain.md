---
category: Fixed
audience: internal
---

**The files host is the content domain, and it lets the app's own pages read a recording.**
`FILES_ORIGIN` is now `files.magnacartausercontent.com` instead of the `files.example.com`
placeholder. The CORS grant and the `frame-ancestors` source on the cookieless preview path are now
read from `APP_BASE_URL` (the app's host and its subdomains) instead of from the files host's
parent domain. The files host sits on a separate registrable domain from the app, so the old rule
would have refused the app itself, and the watch page, which loads a recording with
`crossorigin="anonymous"`, would have failed to load every video once the host carried traffic. The
host carries traffic once the zone routes `files.magnacartausercontent.com/*` to the `magna-carta`
Worker.
