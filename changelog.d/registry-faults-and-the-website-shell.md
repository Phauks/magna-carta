---
category: Fixed
audience: public
---

**A registry fault no longer reads as an empty WHOIS record, and the Safe Website Viewer becomes a
shell-and-tabs surface.** `queryRdap` parsed every non-200 as an empty body, so a registry's
transient 429 rendered as "No registration record found" — which the next retry contradicted with
the real record. Only a 404 (RDAP's answer for an unregistered name) now parses as absence; every
other non-200, and a failed IANA bootstrap fetch, throws `RdapUpstreamFailure`, which the route
answers as a retryable 502 (`service-unavailable`) and the page renders as "the registry did not
answer, try again" — never an Error ID, never a false absence. IP-network records also gain their
`registrant` entity (the field the schema always declared and the parser never filled — 8.8.8.8
now names Google LLC). The viewer page is rebuilt per owner direction: a browser-shell viewport on
the left that holds its frame while the isolated browser works and populates only the finished
screenshot (nothing partial ever appears), with the capture's facts in tabs on the right
(Redirects, Page Text, Links, Headers). Both web-domains pages lose their intro paragraphs and
footers under the new "No info lines" ruling in `docs/conventions/design-corrections.md`.

## Public

**WHOIS lookups stop telling you a registered domain has no record.** When a registry is briefly
rate-limiting or unavailable, the lookup now says exactly that and invites a retry — before, it
wrongly reported that no registration record existed. Looking up an IP address now also names the
organization the address block is registered to. The Safe Website Viewer gets a cleaner shape: the
captured site appears in a browser-style frame on the left, which stays calm until the isolated
browser has fully finished rendering — you never see a half-loaded suspect page — and everything
the capture learned sits in tabs beside it: the redirect trail, the page's text, its outbound
links, and the server's response headers.
