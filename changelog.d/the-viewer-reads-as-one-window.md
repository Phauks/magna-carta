---
category: Changed
audience: public
---

**The Safe Website Viewer composes as one window and leads with an Overview.** The shell and the
information tabs unify into one framed composition; clickable addresses (outbound links, redirect
hops — still buttons that capture in the viewer, never anchors to the suspect site) wear the
standard hyperlink register, now a standing rule in `docs/conventions/design-corrections.md`
alongside the unmistakable-toggle rule the Static/Live control is restyled to. The landed-URL row
gains its own copy control; the screenshot gains Download Image and a full-screen overlay; the
loading viewport shows the URL being captured, elapsed seconds, and one honest status line. A new
Overview tab leads the right side with facts derived from the capture already in hand (final
status, content type, server, redirect and link counts, captured-at, duration, the different-site
flag), and a Registration tab runs the WHOIS lookup in place for the captured host through the
shared lookup seam (lazy on first open, cached per host, with the same visible retry ladder) — no
redirect to the WHOIS page. Facts needing new backend probes (resolved IP, TLS certificate,
hosting provider) are recorded as seams, not faked.

## Public

**The viewer now reads as one window.** The captured site and its facts sit in a single frame, and
the facts lead with an Overview: the final status, content type, server, how many redirects and
outbound links, when the capture was taken and how long it took. Anything clickable looks like a
link. You can copy the landed address, download the screenshot as an image, and open it full
screen. While a capture runs, the viewer shows the address being opened and the seconds elapsing.
And a Registration tab shows who registered the captured site's domain, right there in the viewer.
