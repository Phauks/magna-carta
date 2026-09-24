# Safe Website Viewer

View what a suspicious website looks like — safely. The page opens on a remote computer, not yours, so no harmful code can reach your device.

## What it does

When you receive a link you do not trust — in an email, a document, or a message — you can use the Safe Website Viewer to find out what that link actually leads to, without opening it in your own browser.

Magna Carta loads the page on a separate, isolated computer in the cloud. That computer visits the site, takes a screenshot, and collects facts about the page. Only the screenshot and the collected facts are sent back to you. **The live page itself never loads in your browser.** You see a picture and text, not an active webpage — so even if the site contains malicious code, it cannot run on your device or reach your accounts.

For each page you see:

- **Screenshot** — a full-page image of what the site looks like when loaded.
- **Where the link went** — every address the link passed through before landing. This is how cloaked links and phishing redirects are exposed.
- **Page text** — the site's visible words, as plain text.
- **Links** — the addresses the page points to.
- **Headers** — technical details about how the server responded.
- **Registration** — who registered the site's domain and when.

## Static and Live

The two buttons beside the address bar choose how the viewer opens pages.

**Static** opens every link in a fresh isolated computer. Each look is independent: nothing carries over from one page to the next. Use it for a quick check of a single link.

**Live** keeps one isolated computer for you while you look around. Cookies carry over from page to page, so you can follow a link through the steps it was built to hide — a short link, then a "confirm you are human" page, then whatever sits behind it.

In both modes, only pictures and text come back. Live does not let the site run on your computer any more than Static does.

**Live ends on its own.** If you stop for about three minutes, or keep going for fifteen, the isolated computer is closed and the next page starts fresh. When that happens the viewer tells you that cookies from earlier pages are gone, because the next page may behave differently. Switching back to Static, or leaving the viewer, closes it straight away.

## Common tasks

**View a suspicious link**

1. Select **Safe Website Viewer** in the **Internet** group of the sidebar's Tools.
2. Paste the link into the address bar. A bare domain like `example.com` is fine; the viewer adds the rest.
3. Select **Load Website**.
4. The screenshot appears on the left and the details on the right, usually within a few seconds.

While it loads, the viewer tells you where the link is really going, often before the picture is ready — a link that says one thing and leads somewhere else is the most common trick.

**Check where a shortened or redirected link leads**

Paste the shortened link. The **Redirects** tab shows every address it passed through. The **Overview** tab says plainly when the link ended up on a different site from the one it started on.

**Follow a link through several steps**

Switch to **Live**, then load the link. To go to the next page, choose an address on the **Links** or **Redirects** tab — it opens in the same isolated computer, with the cookies from the page before. Back and forward show pages you already looked at, straight away and without visiting them again.

**Read the page text without images**

The **Page Text** tab shows the site's readable content even when the screenshot is hard to read at small size.

## When a page will not load

- **"That page could not be rendered"** — the viewer reached the address but the page did not finish loading. It may be very slow, very large, or broken. In Static, the viewer has already tried a second, simpler way before telling you this. Pages built to deceive often behave like this on purpose.
- **"That address cannot be viewed"** — the address is not a public website. Private, local and internal addresses are refused on purpose, including when a page tries to send the viewer to one.
- **"The isolated browser is not available right now"** — the service is busy. Wait a moment and try again.
- **"The capture failed"** with an Error ID — something went wrong on our side. Quote the Error ID to support.

## Tips and edge cases

- **A screenshot shows the page at one moment.** Sites that change their content based on your location or device may show something different from a direct visit. That difference is itself useful information.
- **Some sites block automated visitors.** A page that detects automated access may show a CAPTCHA, a blank screen, or an error page. This does not mean the link is safe — it means the site tried to hide itself. Live mode can sometimes get past a simple "confirm you are human" step.
- **The tool does not give you a safety verdict.** You see the facts: what the page looks like, where it went, and what it links to. Deciding whether to trust or act on a site is your judgement.
- **A page that looks like a sign-in screen is still just a picture of one.** The viewer never types anything into a page for you, and there is no way to enter a password through it. The right response to a fake sign-in page is to report the link, not to go and sign in.
- **Nothing is saved.** Screenshots and page details are shown to you and then discarded; nothing is stored in Magna Carta. To keep evidence of how a site looked, use the download button above the screenshot.
- **The site sees a visit.** Opening a link here does not show the sender that you opened it on your own device, but the site can tell that something visited it.

## Why this is safe

The key protection is isolation: **the suspect page never loads in your browser.** Your browser only ever receives an image and text — inert data that cannot run code. The remote computer that does the visiting is purpose-built for this, runs in a restricted environment, and is closed after each capture in Static or when your Live session ends. Even if a site tried to attack the visitor, it would be attacking that isolated system, not your device or your Magna Carta session.

## Related features

- **WHOIS Lookup** — the full registration record for a domain. Using both tools together gives you a fuller picture of a suspicious link.
- **[Your sidebar](your-sidebar.md)** — Safe Website Viewer sits in the **Internet** group of the sidebar's Tools, beside the WHOIS Lookup and the Network Speed Test.
