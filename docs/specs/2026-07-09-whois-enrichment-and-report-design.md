# WHOIS enrichment and the printable report — design

**Date:** 2026-07-09 · **Status:** design, not yet approved

The WHOIS Lookup page ships a query box and a result card. It answers "who registered this, and when."
The goal now is a different one: **produce a document a lawyer can hand to someone else.** That changes
what must be gathered, how absence must be rendered, how times must be written, and what the page owes
in the way of authority.

The reference point is ICANN's own lookup at `lookup.icann.org`. Match its coverage, and where it
explains a term, link to the explanation rather than paraphrasing it.

## What we have, and what we throw away

`packages/whois/src/rdap.ts` `queryRdap` fetches the RDAP object, extracts six things, and **discards the
body**:

- three of the `events` — `registration`, `expiration`, `last changed`
- `nameservers[].ldhName`
- the top-level `status[]`
- the registrar entity's vCard `fn`

Everything else in a conformant RDAP domain response is dropped. Concretely, and each of these is a field
ICANN's lookup displays:

| RDAP field | What it is | Why a report wants it |
| --- | --- | --- |
| `handle` | Registry Domain ID (ROID) | The registry's own identifier for the registration |
| `unicodeName` | The IDN form of the name | `xn--` names are unreadable without it |
| `entities[].publicIds` | The registrar's **IANA ID** | Uniquely identifies the registrar; a name is not unique |
| `entities[role=abuse]` | Abuse contact email and phone | ICANN requires it; it survives privacy redaction |
| `secureDNS.delegationSigned`, `dsData` | DNSSEC status | Whether the zone is signed |
| `nameservers[].ipAddresses` | Glue records (v4/v6) | We take only the names |
| `port43` | The registry's legacy WHOIS host | Provenance |
| `remarks[]`, `notices[]` | Registry statements | **This is where a registry says "REDACTED FOR PRIVACY"** |
| `events[transfer]`, `events[last update of RDAP database]` | More dates | Transfer history matters in disputes |
| `entities[role=registrant/administrative/technical]` | Contacts | Usually redacted — but see below |
| `rdapConformance[]` | Which RDAP profile answered | Provenance |

## Three defects this work must fix

**IP lookups return almost nothing.** `extractRegistrar` looks for an entity with the `registrar` role;
an RDAP *network* object has none. `extractNameservers` looks for a `nameservers` array; a network object
has none. So an IP query yields `status[]` and perhaps two dates, and drops `startAddress`, `endAddress`,
`cidr0_cidrs`, `ipVersion`, `name`, `type`, `country`, `parentHandle`, and the abuse contact. The page
advertises "domain or IP address" and the IP half is hollow. Worse, a sparse IP result can render as
"No registration record found", which is false.

**Times are rendered in the reader's local zone.** The result card formats `registeredAt` with a local
timestamp. A registration dated `1995-08-14T04:00:00Z` currently reads `Aug 13, 1995, 09:00 PM` west of
Greenwich. **All displayed and exported times are UTC**, written unambiguously (`1995-08-14 04:00 UTC`).
A document that a reader in another timezone opens must say the same thing it said here.

**The raw response is not retained.** It cannot be shown, downloaded, hashed, or attached.

## Absence is evidence

The card omits fields the registry did not return. That is right for a screen and wrong for a report.
A report must distinguish three different silences, and RDAP gives us the means to:

- **Not provided by the registry** — the field is simply absent from the response.
- **Redacted for privacy** — the registry says so, in `remarks[]` (and, under the ICANN RDAP response
  profile, with a `redacted` remark type). This is a statement *by the registry*, and quoting it is
  stronger than inferring it.
- **Not applicable** — nameservers on an IP network object; a registrar on an IP allocation.

A blank cell says none of these. The report says which.

## Authority: link, do not paraphrase

Status codes are the place a reader most needs help, and ICANN already wrote the explanation.

**Verified** (2026-07-09, by loading the page): ICANN's EPP status code page at
`https://www.icann.org/resources/pages/epp-status-codes-2014-06-16-en` carries an HTML anchor for every
code, in **both** casings — `#clientTransferProhibited` and `#clienttransferprohibited`, `#pendingDelete`
and `#pendingdelete`, and so on for `ok`, `inactive`, `addPeriod`, `autoRenewPeriod`, `renewPeriod`,
`transferPeriod`, `redemptionPeriod`, and the full `client*` / `server*` / `pending*` families. So each
status a registry returns can be linked to its own definition.

**The casing does not match, and this is the trap.** RDAP does not use EPP spelling. Per RFC 9083 a
registry returns `"client transfer prohibited"` — lowercase, space-separated. ICANN's anchors are
camelCase. A mapping is required (RFC 8056 defines the EPP↔RDAP correspondence). Some RDAP status values
have **no** EPP equivalent (`active`, `associated`); those must render as plain text with no link rather
than a link that 404s to an anchor that does not exist.

Do not hardcode the mapping from memory. Derive it, test it against the anchor list, and make an unknown
status degrade to unlinked text.

## The report

Tools are ethereal — nothing is saved, no history, no local storage. The report inherits that: it is
generated from the response in hand and handed to the user, never stored.

**What the document contains.** The exact query as typed. The UTC timestamp of the lookup. Which server
answered — the bootstrap-resolved RDAP base URL, or the port-43 host. Every field, present or absent,
with absence typed as above. The status codes with their ICANN links. And the complete, unmodified
response.

**Why the raw payload matters.** This document may become an exhibit. A summary is an assertion; the raw
RDAP JSON (or the raw port-43 text) is the record. Printing a digest of it alongside — the firm already
ships a File Hash & Integrity tool — lets the document authenticate itself.

**How it leaves the browser.** Three candidates, cheapest first:

1. **A print stylesheet plus `window.print()`.** A literal printable report. No new infrastructure, no
   server round trip, and the browser's own "Save as PDF" gives a file. Honest with the ethereal rule.
2. **A raw JSON (or text) download.** The evidentiary artifact, nearly free, and the thing a technical
   reader will actually want.
3. **A server-rendered PDF** through the in-house pure-Rust engine. The polished answer, and a real slice
   of work. Not yet.

Recommendation: 1 and 2 now, 3 when the tool has a reason to leave the browser.

## Shape of the work

This is a backend slice with a UI tail, not a UI change.

1. `packages/whois` — stop discarding the body. Extend `RegistrationResult` with the fields above, add a
   network-object extractor for IP queries, retain the raw payload and the responding server. Distinguish
   absent from redacted using `remarks[]`.
2. The contract — `WhoisResponse` grows; `emit-openapi` and `generate-client` in the same commit, as the
   byte-exact snapshot test requires.
3. The page — UTC everywhere; a fuller card; statuses linked to ICANN; absence rendered with its reason;
   print view and raw download.
4. A status-code module with the RDAP→EPP mapping, its own unit tests, and an explicit unknown path.

## Open questions for the owner

- **Is this an exhibit?** If yes, the timestamp, responding server, and response hash are mandatory and
  the raw payload must be embedded rather than linked. If it is a convenience summary, the report is
  lighter and the hash is noise.
- **Contacts.** Registrant/administrative/technical entities are usually redacted, but not always for
  ccTLDs and never for some legacy records. Do we display them when present? A registration record naming
  a private individual is personal data, and the page currently has no session, no permission check, and
  no audit trail. `whois.get` is not audited today.
- **Legacy port-43 parsing.** Six ccTLDs answer only in free text. Do we parse it into fields (fragile,
  registry-specific) or keep presenting it verbatim (honest, less useful in a report)?

## What this does not do

No caching, no history, no matter attachment. The Tools area stays ethereal; pulling a lookup into a
matter is a separate, deliberate act, and does not exist yet.
