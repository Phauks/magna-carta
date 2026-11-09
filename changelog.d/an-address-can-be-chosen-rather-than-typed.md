---
category: Added
audience: internal
---

Address autocomplete: the street box of the one address form offers real addresses as a person types, and choosing one fills the rest of the form.

**The United States is answered from the platform's own index.** A build Container indexes OpenAddresses every month into a platform R2 bucket — four census-region splits, about 62 bytes an address — and a query Container that sleeps when nobody is typing reads them by range. There is no per-lookup bill, no quota and no attribution badge, and what is typed never leaves the platform's account. The engine ranks addresses in the region the form already holds, or in the caller's primary office's region, first, without hiding the rest, and a chosen address comes back with its coordinates for whatever later needs a map. Sources whose recorded licence is share-alike, non-commercial or a bespoke agreement are left out, and every build records which sources it used.

**Every other country goes to Smarty, when its key pair is set.** Smarty was chosen on storage terms rather than coverage or price: the address a person picks is written into a permanent record, and of the large autocomplete services one lets a customer keep only its own place identifier while another treats every result as temporary.

A building with many units is offered as one line with a count, and choosing it offers the units in turn, because writing the building's line into a record whose client lives in unit 4B is a letter that does not arrive.

The Worker serves it through two read-shaped POSTs rather than GETs. Its invocation log records every request's full URL, query string included, and what is being sent is a client's address a few characters at a time; a body is not in that log. What the Worker counts is which operation ran, which engine served it and how it came out — nothing that could carry an address.

**Dormant until provisioned.** With neither engine provisioned, every answer is "unavailable" and the address form behaves exactly as before. The platform's index switches on when the `magna-carta-addresses` bucket exists, the address worker is deployed, and the app worker gains its `ADDRESS_SERVICE` binding; the first daily cron after that builds the index. Smarty switches on with `SMARTY_AUTH_ID` and `SMARTY_AUTH_TOKEN`. No deploy waits on either.
