---
category: Fixed
audience: internal
---

**The files host lets the app's own pages read a recording.** The CORS grant and the
`frame-ancestors` source on the cookieless preview path are now read from `APP_BASE_URL` (the app's
host and its subdomains) instead of from the files host's parent domain. The files host is meant to
be `files.magnacartausercontent.com`, a separate registrable domain from the app, so the old rule
would have refused the app itself, and the watch page, which loads a recording with
`crossorigin="anonymous"`, would have failed to load every video once that host carried traffic.
