# WHOIS Lookup

Use WHOIS Lookup to see who owns a website or IP address, when it was registered, and where it is hosted — without leaving Magna Carta.

## What it does

When a domain name or IP address appears in a matter — on a piece of correspondence, in a contract, or in a document you have received — you can look it up immediately. WHOIS Lookup retrieves the public registration record for that domain or address and shows you:

- **Registrar** — the company through which the domain is registered.
- **Registration date** — when the domain was first registered.
- **Expiry date** — when the registration is due to lapse.
- **Last-changed date** — when the record was last updated.
- **Nameservers** — which DNS infrastructure the domain is pointed at.
- **Registry status** — the current administrative state (e.g. active, locked, pending deletion).
- **Registrant information** — the name, organisation, or contact details the registrant made public (many registrants now use privacy protection, so this field may be redacted by the registry).

For country-code domains that publish only a plain-text record, the raw WHOIS text is shown instead, clearly marked as unprocessed text from the registry.

## Common tasks

**Look up a domain name**

1. Open the Tools sidebar.
2. Select **WHOIS Lookup** under **Websites & Domains**.
3. Type or paste the domain name (for example `example.com`) and press Enter.
4. The registration details appear below the search box.

**Look up an IP address**

Follow the same steps, entering an IPv4 or IPv6 address instead of a domain name.

**Look up a domain from a full URL**

You can paste a complete web address (for example `https://www.example.com/page`) — the tool extracts the domain for you.

## Tips and edge cases

- **Privacy-protected registrants.** Many domain owners use a privacy service; registrant contact fields will show the proxy's details or be blank. This is expected behaviour from the registry, not a lookup failure.
- **Country-code domains.** Some country-code top-level domains (for example `.uk`, `.de`, `.jp`) do not publish structured data. For these, the tool falls back to the plain text from the registry's WHOIS server and labels the result accordingly.
- **Newly registered domains.** A very recently registered domain may not yet appear in the registry's public data; allow a few hours for the record to propagate.
- **This tool does not give legal advice.** The registration record tells you who registered a domain and when. It does not tell you who currently controls the underlying server, what laws apply to its operator, or whether the domain is involved in wrongdoing.

## Related features

- **Safe Website Viewer** — if you want to see what a suspicious website actually shows without risk, use the Safe Website Viewer alongside a WHOIS lookup.
- **Tools** — WHOIS Lookup is one of the tools in the **Websites & Domains** group, accessible from the Tools sidebar.
