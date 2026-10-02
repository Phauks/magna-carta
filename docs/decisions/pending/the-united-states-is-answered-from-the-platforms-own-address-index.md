---
slug: the-united-states-is-answered-from-the-platforms-own-address-index
status: Accepted
area: Directory
date: 2026-10-02
summary: "Address autocomplete for the United States runs on an index the platform builds itself from OpenAddresses every month, stored in one platform R2 bucket as four census-region Tantivy splits and read by range from a Container that sleeps when nobody is typing; Smarty, unchanged, answers every other country when its key pair is set. A measured spike decided it: 62 bytes an address, one ranged read for a warm keystroke at the median, p90 under 220 ms even at 100 ms a read once result rows are fetched in parallel, and OpenStreetMap holding the house number for only 31 of 200 sampled US addresses. Sources with share-alike, non-commercial or bespoke-agreement licences are excluded; unrecorded and indemnification-only licences are included, and every build writes an attribution manifest. The engine is a dedicated address worker that, unlike the search worker, holds its own R2 binding, because address data belongs to no firm."
---

**The United States is answered from the platform's own address index.**

**Context:** the address lookup routes, the form and the port shipped with Smarty as the first engine,
chosen on storage terms and dormant until a paid account exists. The owner asked for the self-hosted
route with persuasion, then for a spike to measure it, and then to build it. The spike indexed every
OpenAddresses source for North Carolina and Nevada (16.0M rows, 11.1M after de-duplication) and replayed
300 randomly chosen real addresses one keystroke at a time through `search-core`'s range-reading
directory, with real R2 latency injected.

**Decision — an index the platform builds and keeps.** The United States goes to an index of
OpenAddresses that a build Container produces every month and a query Container reads by range from a
platform R2 bucket. The index is four Tantivy splits, one per census region, because one country-wide
split cannot be merged to a single segment on a Container's 20 GB disk; a query reads all four in
parallel. The query Container keeps the splits open and caches the bytes it has read, which the search
engine must never do with a firm's discovery splits and which is right here, because the data is public
and identical for every firm. Every other country goes to Smarty when its key pair is set, through a
port that routes by country, and is not covered otherwise.

What decided it, measured rather than estimated: an address costs 62 bytes of index (10–12 GB for the
country); a warm keystroke reads once at the median and eight times at p90, and with the result rows
fetched in parallel the p90 is 81 ms at 30 ms a read and 219 ms at 100 ms; 273 of 300 addresses were
offered in the top eight by the ninth character, the misses being units of large buildings (which the
port already answers as groups) and dirty source rows. The cost falls inside what the account already
includes: 10 GB-month of R2 storage, 10M reads, 25 GiB-hours of Container memory.

**OpenStreetMap is not the source.** Photon, the mature open autocomplete engine, answers from
OpenStreetMap, which held the house number for 31 of 200 sampled US addresses. It also needs Java,
OpenSearch and its index on local disk, so it cannot sleep: always on, it costs more each month than
everything here combined.

**Licences.** OpenAddresses does not relicense its sources, and 88% of US sources record no licence at
all. Excluding them would empty the index, so the rule excludes what a recorded licence forbids or
encumbers — share-alike (CC BY-SA, ODbL), non-commercial, and a bespoke licence agreement — and keeps
the rest, including the twenty-six layers whose recorded licence is only an indemnification clause. The
register of exclusions lives in the build job with each reason beside it, and every build writes the
list of sources it used. **The owner may reverse the indemnification call**; that is a change to the
register, not to the design.

**A dedicated worker that holds its own bucket.** The engine follows the search worker's shape — a
worker reached only by service binding, Containers with no internet, object reads through an
intercepted host — with one deliberate difference: it binds the R2 bucket itself. The search worker must
not, because which bucket holds a firm's bytes is one decision made in the app worker. Address data
belongs to no firm, so there is no such decision, and routing every keystroke's reads through the app
worker would add a hop for nothing. The build Container fetches OpenAddresses through a second
intercepted host that forwards exactly two URL shapes.

**The port gained two optional fields.** A suggestion may carry `near`, a region to rank first — filled
from the form's region, or from the caller's primary office — which biases and never filters. A resolved
address may carry `location`, the coordinates the data records: geocoding comes with the corpus, and
the contract carries it now so that a map or a mileage figure later is a schema change on the surface
that needs it, not a second engine.

**Considered and rejected:** Smarty for the United States too (a per-lookup bill and an account, for
better unit coverage the spike showed matters for large buildings only); Google Places (about $350 a
month at 20,000 addresses, storage terms that cover a user's own transaction rather than a permanent
client record, a required logo, and typed client addresses retained by Google); Photon over
OpenStreetMap (house numbers, and it cannot sleep); Airmail and Cairn (the same architecture as this,
but a demo last touched in March 2025 that needs a C library, and a month-old alpha); a single
country-wide split (the merge does not fit the disk); per-state splits (51 reads a keystroke); reading
through the app worker (a hop a keystroke for a tenancy decision that does not exist).

**Consequences:** with the address worker deployed and bound, US addresses are suggested with no
per-lookup cost and nothing leaving the platform's account. The index is as good as the public data:
unit numbers are thin (one row in eight carries one) and 898 of 2,300 US sources had not refreshed in a
year when this was decided. The platform takes on a monthly build it owns, an account step to create
the bucket and bind the worker, and an attribution duty it meets with the manifest.
