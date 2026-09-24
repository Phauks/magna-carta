# Safe Website Viewer

The Safe Website Viewer shows you what a link leads to without opening it on your own computer. Paste
a link you do not trust — from an email, a text, a document — and it is opened on an isolated
computer somewhere else. What comes back to you is a picture of the page and its text, so nothing
from the site can run on your device.

Find it under **Safe Website Viewer**, in the Internet group of the sidebar's Tools. Nothing you do
here is saved, and it is not attached to any matter.

## Checking a link

1. Paste the link into the address bar at the top of the viewer. A bare domain like `example.com` is
   fine; the viewer adds the rest.
2. Press **Load Website**.
3. The page appears as a picture on the left. The panel on the right tells you about it.

While it loads, the viewer tells you where the link is really going, often before the picture is
ready — a link that says one thing and leads somewhere else is the most common trick, and this is
where you see it.

## Static and Live

The two buttons beside the address bar choose how the viewer opens pages.

**Static** opens every link in a fresh isolated browser. Each look is independent: nothing carries
over from one page to the next. Use it for a quick check of a single link.

**Live** keeps one isolated browser for you while you look around. Cookies and sign-in state carry
over from page to page, so you can follow a link through the steps it was built to hide — a short
link, then a "confirm you are human" page, then whatever sits behind it. Click an address in the
panel on the right to go there next.

In both modes, only pictures and text come back. Live does not let the site run on your computer any
more than Static does.

**Live ends on its own.** If you stop for about three minutes, or keep going for fifteen, the isolated
browser is closed and the next page starts fresh. When that happens the viewer tells you that
cookies from earlier pages are gone, because the next page may behave differently. Switching back to
Static, or leaving the viewer, closes it straight away.

## What the panel tells you

- **Overview** — where the link started, where it ended up, and whether it ended up on a different
  site. A link that crosses to a site you did not expect deserves suspicion.
- **Redirects** — every stop the link made on the way. Each one is an address you can open next.
- **Page Text** — the words on the page, as plain text you can read or copy.
- **Links** — the addresses the page points to. They are shown as text, never as links you can
  click by accident; choosing one opens it in the viewer.
- **Headers** — the technical details the site's server sent back with the page.
- **Registration** — who registered the site's domain and when, looked up when you open the tab.

Back, forward and refresh work as they do in a browser. Back and forward show pages you already
looked at, straight away and without visiting them again.

## When a page will not load

- **"That page could not be rendered"** — the viewer reached the address but the page did not
  finish loading. It may be very slow, very large, or broken. In Static, the viewer has already tried
  a second, simpler way before telling you this. Pages built to deceive often behave like this on
  purpose.
- **"That address cannot be viewed"** — the address is not a public website. Private, local and
  internal addresses are refused on purpose, including when a page tries to send the viewer to one.
- **"The isolated browser is not available right now"** — the service is busy. Wait a moment and try
  again.
- **"The capture failed"** with an Error ID — something went wrong on our side. Quote the Error ID to
  support.

## Tips

- Treat anything the viewer shows as untrusted. A page that looks like your bank's sign-in screen is
  still just a picture of one, and the right response is to report the link, not to go and sign in.
- The viewer never types anything into a page for you, and there is no way to enter a password
  through it.
- Opening a link here does not tell the sender you opened it on your own device — but the site does
  see that something visited it.

## Related

- **WHOIS Lookup** — the full registration record for a domain.
