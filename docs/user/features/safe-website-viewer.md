# Safe Website Viewer

View what a suspicious website looks like — safely. The page opens on a remote computer, not yours, so no harmful code can reach your device.

## What it does

When you receive a link you do not trust — in an email, a document, or a message — you can use the Safe Website Viewer to find out what that link actually leads to, without opening it in your own browser.

Here is how it works: when you submit a URL, Magna Carta loads the page on a separate, isolated computer in the cloud. That computer visits the site, takes a screenshot, and collects facts about the page. Only the screenshot and the collected facts are sent back to you. **The live page itself never loads in your browser.** You see a picture and text, not an active webpage — so even if the site contains malicious code, it cannot run on your device or access your accounts.

The viewer returns:

- **Screenshot** — a full-page image of what the site looks like when loaded.
- **Final address and redirect chain** — if the link bounced through several addresses before landing, you see every step. This is how cloaked links and phishing redirects are exposed.
- **Page title and text** — the site's visible words, extracted as plain text.
- **Outbound links** — the links the page tries to send you to.
- **HTTP response information** — technical details about how the server responded (status code, content type, and key headers).

## Common tasks

**View a suspicious link**

1. Open **Tools → Internet** in the sidebar.
2. Select **Safe Website Viewer** under **Websites & Domains**.
3. Paste the URL into the address box.
4. Select **View Safely**.
5. The screenshot and page details appear when the remote capture completes (usually a few seconds).

**Check where a shortened or redirected link leads**

Paste the shortened URL. The redirect chain panel shows every address the link passed through before landing. If the final destination differs from what the sender claimed, the chain makes that visible.

**Read the page text without images**

The extracted text panel shows the site's readable content even when the screenshot is hard to read at small size.

## Tips and edge cases

- **This is a snapshot, not a live view.** The screenshot reflects the page at the moment of capture. Sites that change content dynamically (for example, based on your location or device) may show different content than a direct visit would. That difference is itself useful information.
- **Some sites block automated visitors.** A page that detects automated access may show a CAPTCHA, a blank screen, or an error page in the screenshot. This does not mean the link is safe — it means the site tried to hide itself.
- **The tool does not give you a safety verdict.** You see the facts: what the page looks like, where it went, and what it links to. Deciding whether to trust or act on a site is your judgement call, based on what you see.
- **Private and internal addresses cannot be viewed.** For your firm's security, the tool only follows links to public internet addresses. Internal network addresses, private IP ranges, and non-web addresses are rejected before any capture is attempted.
- **Captures are not saved.** The screenshot and page data are shown to you and then discarded. Nothing is stored in Magna Carta. If you need to preserve evidence of a site's appearance, save a copy yourself.

## Why this is safe

The key protection is isolation: **the suspect page never loads in your browser.** Your browser only ever receives an image and text — inert data that cannot execute code. The remote computer that does the actual visiting is purpose-built for this task, runs in a restricted environment, and is discarded after each capture. Even if a site tried to attack the visitor, it would be attacking that isolated system, not your device or your Magna Carta session.

## Related features

- **WHOIS Lookup** — for the same domain, WHOIS Lookup shows who registered it and when. Using both tools together gives you a fuller picture of a suspicious link.
- **[Your sidebar](your-sidebar.md)** — Safe Website Viewer sits in the **Internet** group of the sidebar's Tools, beside the WHOIS Lookup and the Network Speed Test.
