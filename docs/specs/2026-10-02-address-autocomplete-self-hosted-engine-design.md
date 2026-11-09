# Address autocomplete — the self-hosted engine

**Date:** 2026-10-02
**Status:** Built · Area: `crates/address-core` (new), `containers/address` (new), `apps/address-worker`
(new), `packages/address-lookup`, `apps/api-worker/src/address-lookup/`
**Scope:** The engine behind `AddressLookupPort` for the United States, run on the platform's own
Cloudflare account from open address data, so that typing an address into a form is answered without a
per-lookup bill, a quota, an attribution badge, or a client's address leaving the platform. The port, the
two routes, the form and the metric already exist and do not change shape; this spec adds an engine
behind them and a seam for coordinates.

## Why

The port was built engine-agnostic, with Smarty as the first adapter and nothing provisioned. The owner
then asked for the self-hosted route, with a measured spike first. The spike settled the open
questions with numbers rather than estimates:

| Question                     | Measured (North Carolina and Nevada, every OpenAddresses source)                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rows, after cleaning         | 15.97M raw → 11.12M distinct. 22.5% duplicates (statewide and county files overlap), 7.9% missing a number or street                                                       |
| Index size                   | 0.69 GB, **62 bytes an address**. The United States extrapolates to 10–12 GB                                                                                               |
| Build time                   | 140 s for 11.1M addresses on two threads                                                                                                                                   |
| Does the right address show? | 273 of 300 random addresses in the top eight, by the 7th character typed at the median and the 9th at p90. The misses were units in large buildings, and dirty source rows |
| Read cost a keystroke        | Warm: 1 ranged read at p50, 8 at p90. First query after an open: 35 reads, about 35 MB                                                                                     |
| Latency a keystroke          | With rows fetched in parallel: p50 48 ms / p90 81 ms at 30 ms a read; p50 118 ms / p90 219 ms at 100 ms a read                                                             |
| OpenStreetMap as the source  | Photon (OpenStreetMap) had the house number for 31 of 200 sampled addresses. Ruled out as the source                                                                       |
| R2 range read latency        | 120 ms p50 measured from outside Cloudflare, of which about 30 ms was network                                                                                              |

The rest of the case is cost and terms: R2 includes 10 GB-month of storage and 10M reads a month, a
Container bills only while awake, and the data is the platform's to keep. Google's equivalent was
$350 a month at 20,000 addresses a month, with storage terms that do not clearly cover a permanent
client record.

## Goal

A US address typed into any address form is offered back within the 300 ms the form already waits for
a pause, from an index the platform builds itself every month from OpenAddresses, stored in one R2
bucket, read by range from a Container that sleeps when nobody is typing.

## Out of scope

- Countries other than the United States. The port answers `no-coverage` for them, or routes them to
  Smarty if its secrets are set (the existing adapter, unchanged).
- Storing coordinates on a record. The engine returns them (geocoding comes free with the data), the
  contract carries them, and no screen writes them yet — that is a schema change for whichever surface
  first needs a map or a distance.
- Reverse geocoding (coordinates to an address), deliverability, NCOA. Deliverability was ruled worth
  nothing for this product; NCOA and skip tracing wait for a user to ask.
- A screen to start a rebuild. The cron does it; the runbook says how to do it by hand.

## Data

**Source.** OpenAddresses, per-source outputs from its batch service. The source list is
`https://batch.openaddresses.io/api/data` (anonymous). Each source's output is
`https://v2.openaddresses.io/batch-prod/job/<job>/source.geojson.gz` (anonymous, a redirect to a
presigned R2 URL). Regional collections need an account and are not used. One line per address:
`{"properties": {"number","street","unit","city","district","region","postcode","hash"}, "geometry": {"coordinates": [lon, lat]}}`.

**Which sources.** Layer `addresses`, source name under `us/`. A source whose recorded licence is
share-alike, non-commercial, or a bespoke licence agreement is excluded; one with a permissive licence,
an indemnification clause only, or no licence recorded is included. 88% of US sources record no
licence at all, so excluding them would empty the index. The exclusion register is `LICENCE_EXCLUSIONS` in
`containers/address/src/build_job.rs`, with the reason beside each entry; on 2026-10-02 it holds six layers:
`us/ca/mono` (CC BY-SA 4.0), `us/or/city_of_tigard` (CC BY-SA 4.0), `us/wa/jefferson` (ODbL 1.0),
`us/wa/spokane` (CC BY-NC-SA 4.0), and both `us/mi/semcog` layers (a bespoke copyright licence
agreement). Twenty-six layers record only an indemnification clause — San Diego County, Fulton County
and San Antonio among them — and are included. This policy is the owner's to confirm (see _Owner
flags_). Every build writes an attribution manifest — each included source, layer and job — beside the
index.

**Cleaning.** Uppercase; non-alphanumerics other than `#` and `-` to spaces; whitespace collapsed.
Street suffixes and directionals to USPS abbreviations (`STREET`→`ST`, `NORTH`→`N`, …). Unit
designators (`APT`, `UNIT`, `STE`, `SUITE`, `#`, `NO`) stripped from the unit value. Postcode cut to
five digits. A row with no number, no street, or no coordinates is dropped. **Duplicates:** the key is
`number|street|unit|postcode-or-city`, kept per state (keys never cross a state, so the set is bounded
by the largest state — Florida's 36.7M rows — not the country).

## Partitions

One index for the whole country cannot be built in a Container: the merge into one segment needs twice
the index's size on disk, about 22 GB, against a 20 GB disk. The country is therefore **four
partitions**, the four census regions (the same four OpenAddresses uses for its collections). The
largest is about 3.5 GB, so its build and merge fit with room. A query reads all four in parallel and
merges by score; a parallel read costs one round trip, not four.

| Partition   | States                                                |
| ----------- | ----------------------------------------------------- |
| `northeast` | CT ME MA NH NJ NY PA RI VT                            |
| `midwest`   | IL IN IA KS MI MN MO NE ND OH SD WI                   |
| `south`     | AL AR DE DC FL GA KY LA MD MS NC OK SC TN TX VA WV PR |
| `west`      | AK AZ CA CO HI ID MT NV NM OR UT WA WY                |

Puerto Rico rides with `south`; every other territory OpenAddresses carries goes there too.

## The index (`crates/address-core`)

Pure Rust over Tantivy, using `search-core`'s split format and `SplitDirectory` unchanged. One Tantivy
segment per partition.

| Field      | Kind                                                   | Purpose                                    |
| ---------- | ------------------------------------------------------ | ------------------------------------------ |
| `number`   | raw string, lowercased, indexed                        | The house number, matched exactly          |
| `words`    | tokenized (simple + lowercase), doc ids only, no norms | Street, unit, city and postcode words      |
| `prefixes` | the edge prefixes (2–12 characters) of the same words  | The word still being typed                 |
| `region`   | raw string, lowercased, indexed                        | Bias toward the caller's state             |
| stored     | number, street, unit, city, region, postcode, lon, lat | The offer, and the parts a resolve returns |

Field norms are off everywhere: the spike's first query spent most of its 35 MB loading them, and the
scoring here does not need document length.

**Query.** The typed text is split into words. The first must start with a digit (the house number,
matched exactly); without a second word there is no query, and the answer is an empty list. Every
middle word matches `words` exactly; the last matches `prefixes` (it is the word being typed). A
`near` region, when given, is a `should` clause with a boost, never a filter: a person in Nevada may be
entering a client in Texas.

**Groups.** The engine takes the top 64 hits per partition, merges them by score, and collapses rows
that share number, street, city and postcode but differ by unit into one **group**. A group's `count` is
a second, exact count over that building (the same words as exact terms plus the postcode or city),
not the number that happened to be in the top 64. A building whose only row has no unit is an
address, not a group. The first `limit` entries (addresses and groups, in score order) are the answer.

**Units.** Opening a group is the same building query, returning every unit (up to 200), sorted by
unit with numbers in numeric order.

**Rows are fetched in parallel.** Tantivy's searcher reads stored rows one at a time; eight sequential
reads were the whole of the spike's p90. The engine fetches the stored rows of an answer concurrently.

**As built (2026-10-02), where the build refined the above.** Scores are constants rather than BM25:
with norms and frequencies off, BM25 varies only with each partition's own statistics, which makes a
four-partition merge arbitrary — so a required clause scores 1, a matching `near` adds 2, and a last word
that matches as a whole word adds 1 (`100 main` ranks MAIN ST above MAINSAIL DR). A word typed in full
also matches its USPS abbreviation, and a two-letter state code also matches the region, so a pasted
whole address finds itself. Abbreviation applies only in suffix or directional position (`LAWSON CREEK
WAY` keeps `CREEK`). Each query's terms are fetched in parallel before Tantivy walks them, which took the
p90 at 100 ms a read from 304 ms to 204 ms. The building query also requires the region. Measured on
the same North Carolina and Nevada data: 60.9 bytes an address; a warm keystroke 2 reads at p50 and 10 at
p90; p50 102 ms and p90 204 ms at 100 ms a read; the right address or its building in the top eight for
100 of 100 sampled addresses, by the 7th character at the median.

## The container (`containers/address`)

A Rust `axum` service on port 8080, one image, run as two Container classes:

- **`AddressIndexContainer`** — answers queries. Small (`basic`: 1 GiB). Holds the four partitions open
  across requests. That is the opposite of `containers/search`, and deliberately: a discovery split is
  one firm's privileged content, so that engine keeps no state between calls; this index is public
  reference data, identical for every firm, so keeping it open is a cache and nothing more. It keeps
  an in-memory cache of the byte ranges it has read, bounded at 384 MB, least recently used out first.
- **`AddressBuildContainer`** — builds. `standard-4` (4 vCPU, 12 GiB, 20 GB disk). Runs only during a
  build.

### Wire contract (JSON, POST unless stated)

`POST /suggestions`

```json
{ "country": "US", "query": "1402 lawson cr", "limit": 8, "near": "NC" }
```

→

```json
{
  "outcome": "suggestions",
  "offers": [
    {
      "kind": "address",
      "label": "1402 LAWSON CREEK WAY, WAKE FOREST, NC 27587",
      "address": {
        "number": "1402",
        "street": "LAWSON CREEK WAY",
        "unit": "",
        "city": "WAKE FOREST",
        "region": "NC",
        "postcode": "27587",
        "longitude": -78.51,
        "latitude": 35.97
      }
    },
    {
      "kind": "group",
      "label": "1042 W CENTER ST, OREM, UT 84057",
      "count": 24,
      "building": {
        "number": "1042",
        "street": "W CENTER ST",
        "city": "OREM",
        "region": "UT",
        "postcode": "84057"
      }
    }
  ]
}
```

or `{ "outcome": "no-coverage" }` for a country with no index, or `{ "outcome": "unavailable" }` when
the index is not built yet or could not be read. `limit` is 1–10, default 8.

`POST /units` with `{ "country": "US", "building": { …as above… } }` → `{ "outcome": "units", "addresses": [ …address objects… ] }`, or `no-coverage` / `unavailable`.

`POST /builds` with `{ "country": "US" }` → `202 { "build": "started" }`, or `409 { "build": "running" }`.
`GET /builds` → `{ "state": "idle" | "running" | "failed", "startedAt", "finishedAt", "detail" }`.
`GET /ready` → `204`.

Error bodies carry engine vocabulary only — never the query, never an address, never an object key.

### Storage (`addresses.magna-carta.internal`, intercepted)

The engine never holds a credential. Every object call goes to a non-routable host that the address
worker intercepts and serves from its `ADDRESS_INDEX` R2 binding. Keys are under the country:

- `us/current.json` — the pointer: `{ "build": "<id>", "builtAt", "documentCount", "partitions": { "northeast": "us/<id>/northeast.split", … }, "attribution": "us/<id>/attribution.json" }`.
  Writing it is the publish: a query container reads it on wake and every ten minutes, and reopens when
  the build id changes.
- `us/<id>/<partition>.split` — a `search-core` split.
- `us/<id>/attribution.json` — the manifest.

| Method and path                               | Meaning                                                          |
| --------------------------------------------- | ---------------------------------------------------------------- |
| `HEAD /objects/<key>`                         | Size in `content-length`; 404 if absent                          |
| `GET /objects/<key>` with `Range: bytes=a-b`  | 206 with exactly those bytes. A GET without a range is refused   |
| `GET /objects/<key>` with `x-mc-whole: small` | The whole object, refused above 1 MiB (pointer and manifest)     |
| `PUT /objects/<key>`                          | Put a small object (pointer, manifest), refused above 1 MiB      |
| `POST /uploads/<key>`                         | Start a multipart upload → `{ "uploadId" }`                      |
| `PUT /uploads/<key>?uploadId=…&part=N`        | One part (every part but the last exactly 64 MiB) → `{ "etag" }` |
| `POST /uploads/<key>/complete?uploadId=…`     | `{ "parts": [{ "part", "etag" }] }` → 204                        |
| `DELETE /objects/<key>`                       | Remove an object (an old build)                                  |

A split is assembled as it uploads: index files then footer, streamed in 64 MiB parts, so a partition
never exists twice on the build disk.

### Source data (`openaddresses.magna-carta.internal`, intercepted)

The build container has no internet. The worker forwards exactly two shapes, and refuses everything
else:

- `GET /api/data` → `https://batch.openaddresses.io/api/data`
- `GET /job/<digits>/source.geojson.gz` → `https://v2.openaddresses.io/batch-prod/job/<digits>/source.geojson.gz`,
  following the redirect to the presigned object.

### Build

1. Fetch the source list; keep US address layers that pass the licence policy; group by partition.
2. For each partition: stream each source's gzip lines, clean, de-duplicate per state, index on four
   threads into a scratch directory, merge to one segment, upload as a split in parts, delete the
   scratch.
3. Write the attribution manifest, then the pointer. Delete the build before the previous one (two are
   kept, so a container mid-query on the old one is never cut off).

A failure leaves the pointer where it was: the old index keeps answering.

## The worker (`apps/address-worker`)

Dedicated, like `apps/search-worker`, reached only by service binding from the app worker. Holds the two
Container classes, the `ADDRESS_INDEX` R2 binding (platform bucket `magna-carta-addresses`), the two
intercepted hosts, and a daily cron. The cron reads the pointer; when it is missing or older than 30
days and no build is running, it starts one. It also exposes `POST /suggestions` and `POST /units` to
the app worker (forwarded verbatim to one query instance) and `GET /ready`.

Unlike the search worker, this one holds an R2 binding. The search worker must not, because which
bucket holds a firm's bytes is one decision made in the app worker. Address data belongs to no firm, so
there is no such decision to keep in one place, and routing reads through the app worker would add a
hop to every keystroke for nothing.

## The app worker and the port

- `packages/address-lookup/src/self-hosted.ts` — `selfHostedAddressLookupPort(fetcher)`: the port over the
  worker's two operations. It mints opaque offer identifiers the way the Smarty adapter does: an address
  identifier carries its own parts, so resolving it reads nothing; a group identifier carries its
  building, so resolving it is one `/units` call. Decoded identifiers are untrusted; anything the adapter
  did not mint answers `expired`.
- `packages/address-lookup/src/routed.ts` — `routedAddressLookupPort({ byCountry, otherwise })`: one port
  over several, chosen by country on `suggest` and by an identifier prefix on `resolve`.
- The port gains an optional `location: { latitude, longitude }` on a resolved address, and the
  resolution response carries it.
- `SuggestInput` gains an optional `near` (an ISO 3166-2 subdivision code without the country prefix,
  e.g. `NC`). The route fills it from the request body's `near` when the form already holds a region,
  and otherwise from the caller's primary office when that office is in the same country.
- `resolveAddressLookupPort(env)`: with an `ADDRESS_SERVICE` binding, the United States goes to the
  self-hosted engine; any other country goes to Smarty when its secrets are set, and is not covered
  otherwise. Without the binding, today's behaviour stands.
- The metric's `engine` dimension gains `openaddresses`.

## Failure behaviour

| Situation                        | Answer                                                    |
| -------------------------------- | --------------------------------------------------------- |
| No index built yet               | `unavailable` (the form says suggestions are unavailable) |
| Country without an index         | `no-coverage`                                             |
| Worker or container unreachable  | 502 through the existing `adapter-error` path             |
| Build fails                      | The previous index keeps answering; the failure is logged |
| Identifier from a previous build | Still resolves: it carries its own parts                  |

## Cost

| Item            | Monthly                                                                        |
| --------------- | ------------------------------------------------------------------------------ |
| R2 storage      | Two builds of 10–12 GB: about 12 GB over the 10 GB included → about $0.03–0.21 |
| R2 reads        | 10M included; an address costs about 5 queries × 4 partitions × 1–2 reads      |
| Query container | `basic` while awake; 25 GiB-hours of memory included a month                   |
| Build container | `standard-4` for about an hour a month, inside the included CPU minutes        |

## Owner flags

1. **Licence policy.** Include sources with no recorded licence (88% of US sources), exclude share-alike
   and bespoke-agreement ones. The alternative is permissive-only, which keeps about an eighth of the
   country.
2. **Account steps** (in `docs/deploy-queue.md`): create the `magna-carta-addresses` bucket, connect
   `apps/address-worker` to Workers Builds, then add the `ADDRESS_SERVICE` binding to the app worker.

## Test plan

- `crates/address-core`: cleaning and de-duplication; the query parser; groups and their exact counts;
  units in order; a round trip through a split and `SplitDirectory`; a read-count test pinning that a
  warm keystroke stays within a small number of reads.
- `containers/address`: the range reader and its cache over a real socket (`tiny_http`); the pointer
  reload; the build against a fake OpenAddresses host and a fake object host, including a failure that
  must leave the pointer untouched; the multipart assembly.
- `apps/address-worker`: the allow-list on both intercepted hosts; the R2 surface (range, size, refusal
  of an unranged GET, the multipart flow) against an in-memory bucket; the cron's staleness decision.
- `packages/address-lookup`: the self-hosted adapter's identifiers (minted, decoded, refused); the routed
  port; resolution carrying coordinates.
- `apps/api-worker`: engine resolution with and without the binding; `near` from the body and from the
  primary office.
