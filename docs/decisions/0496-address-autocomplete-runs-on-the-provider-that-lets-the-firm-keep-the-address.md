---
number: 496
slug: address-autocomplete-runs-on-the-provider-that-lets-the-firm-keep-the-address
status: "Accepted (amended 2026-10-02)"
date: 2026-09-24
area: Directory
summary: "With the owner's ruling that an address may leave the tenancy, the lookup engine was chosen, and the deciding fact was storage terms rather than coverage or price: the address a person picks is written into a permanent record, one of the two largest autocomplete services lets a customer keep only its own place identifier and the other treats every result as temporary, while Smarty lets the firm keep the data — including after cancelling. The engine is dormant until its key pair is provisioned, so no deploy waits on an account and nothing is spent until the owner opens one. The Worker serves it through two read-shaped POSTs rather than GETs, because invocation logging records every full URL and the query is a client's address typed a few characters at a time. It is gated on directory:edit, which covers both forms that ask with no migration. In the form, what is typed is the street line and nothing takes it back; a chosen address replaces the parts it carries and leaves the rest; a building with many units is opened, never chosen; and after one failure the box stops asking until somebody presses Try Again."
---

**Address autocomplete runs on the provider that lets the firm keep the address.**

**Context:** the owner ruled on 2026-09-20 that an address may leave the tenancy, which turned the
choice of lookup engine from a confidentiality question into an ordinary one. The seam already
existed — `AddressLookupPort`, dormant — and needed an engine, a way for the Worker to serve it, and
a place in the one address form.

**Decision — the provider is chosen on what it lets the firm keep.** Every candidate could offer
addresses as someone types. What separates them is what may be done with the answer afterwards, and
here the answer is written into a permanent record: a client's address in the Directory, an office's
on its letterhead. One of the two largest autocomplete services permits storing only its own place
identifier and nothing it displays; the other treats every result as temporary unless a separate
permanent-use agreement is negotiated. Either would make the feature's whole purpose — keeping the
address — a breach of terms. Smarty's terms let the firm keep what it looked up, including after the
subscription ends, and that is the reason it is the engine rather than a feature of its coverage or
its price. **A replacement provider that forbids storing results is not a drop-in, however good its
coverage** — the constraint is recorded in the package's own note so the next person to reconsider
the provider meets it first.

Two services sit behind the one port. The United States goes to Smarty's postal autocomplete, which
returns an address's parts directly, so choosing a US address costs nothing further and reaches
nobody. Every other country goes to its international service in two steps — a free search returning
lines of text, then a charged lookup only when somebody chooses one. Both answer an apartment block
or an office tower as ONE line with a count, which is why the port learned that an offer can be a
group, and why a group is opened onto the addresses inside it rather than written into a record.

**Dormant until provisioned.** The engine is selected per request from two optional secrets. With
either absent, every answer is `unavailable` and the form behaves exactly as it did before — a plain
text box. Neither is a required secret, for the reason the Turnstile key is not: a required name
would make every deploy fail until an account nobody has opened exists. Provisioning the pair is the
act that switches suggestions on and starts the meter, and it is the owner's; the runbook states the
steps, what to watch, and how to switch it off.

**Read-shaped POSTs, and the reason is the log.** Both operations read and write nothing and would
be GETs anywhere else. But the Worker's invocation logging records every request's full URL, query
string included, and what is sent is a client's address a few characters at a time — a GET would
leave a trail of every address anybody entered, fragment by fragment, in a log that cannot be
redacted after the fact. A body is not in that log. The offer identifier stays out of the path for
the same reason: it can carry an address too. Nothing the Worker counts can hold what was typed — the
metric's dimensions are the operation, the engine and the outcome — and no failure carries the query
or the request URL, which with this provider also carries the credentials.

**Gated on `directory:edit`, with no migration.** The Directory's address pane needs `directory:edit`
and the office window needs `locations:manage`; a route takes one permission. Every role holding
`locations:manage` holds `directory:edit` as well — today that is Owner/Admin alone, and a firm
cannot define roles of its own — so the one gate covers both forms. If that stops being true, this
wants a permission of its own rather than a second copy of the route.

**In the form, what is typed is the street line.** A picker's text is a question and its value is the
pick; this box's text IS the value. Every keystroke is written to the record, closing the list leaves
the line exactly as typed, and the offers are a shortcut to filling the other boxes — never a gate on
typing this one. That is why the box is a free-text combobox and not the data-safe one the country
field is, which settles its text back onto a chosen value and would erase an address no service knew.
A chosen address replaces every part it carries, so a stale town from an earlier attempt cannot
survive it, and leaves alone every part it does not, so the unit somebody typed survives a service
that returned only the building. The recipient and organization lines are never touched.

**Four kinds of "no offers", kept apart.** Nothing matched; the country cannot be looked up; no
service is provisioned; the service did not answer. The first two are said in the list, the third by
nothing at all, and the fourth once — after which the box asks nothing until somebody presses Try
Again, because each question to a failing service is another fault counted toward the platform-wide
notice and, where the service is up but refusing, another bill. No abort signal is passed for the
same reason: an abandoned call counts as a fault, and typing overtakes several searches in seconds.

**Considered and rejected:** the two largest autocomplete services (their terms forbid keeping what
the form exists to keep); the self-hosted index over open address data (still possible behind the
same port, and still free per lookup, but an index build, a refresh cadence and weaker unit-level
coverage, bought only to avoid a disclosure the owner has now authorised); calling the provider from
the browser with an embedded key (no rate limit, no metric, and the provider in reach of every
page); GETs (the log); a permission of its own now (a migration for a distinction no role yet has);
retrying automatically after a failure (hammers a failing service and bills a refusing one).

**Consequences:** the address form can offer real addresses in every country the provider covers,
the moment the key pair is set, and not before. The platform takes on a per-lookup bill whose ceiling
is the provider subscription's own quota, because the Worker's rate limit is per isolate. The owner
has a commercial act to take, and until then the feature is present, tested and invisible.

**Amended 2026-10-02:** the self-hosted index rejected above was measured and then built
(ADR-0497). The United States is now
answered from the platform's own index whenever its worker is bound; Smarty, unchanged, answers every
other country when its key pair is set, and the United States only when the platform's index is not
bound. Its offer identifiers now carry the engine's name, because one port routes between the two.
