# Tools catalog — reality check

**Date:** 2026-08-15
**Branch:** `claude/tools-reality-check`
**Scope:** every tool in `packages/tools/src/catalog.ts` (19 manifests), traced manifest → route →
package → whatever it reaches outward for, then exercised as far as this environment allows.

## Why this document exists

`shipped` in the feature ledger means _the artifact exists on `main`_. That is an honest definition
and [`roadmap.d/README.md`](../../roadmap.d/README.md) says so plainly. It is not the same claim as
_a person can use this and get a right answer_, and nobody had checked the second claim for the
Tools area. This is that check.

**Read this before promising a firm that a tool works.** Where a thing could not be determined from
here it says so, and says why, rather than rounding to a verdict.

## How the tools were exercised

- **Worker:** `wrangler dev --local` over `apps/worker/wrangler.jsonc` (Miniflare: local D1, R2,
  Queues, Durable Objects). `--local` rather than the default because the `ai` binding resolves
  remotely and this environment holds no Cloudflare credentials; nothing audited here touches it.
- **Tenant:** `pnpm run seed-dev-firm` (firm `Local Development Firm`, one matter, five files, two
  folders), then a real credential sign-in through Better Auth for a session cookie. Every call
  below traversed the chokepoint with an Owner/Admin session, so permission gating is real, not
  bypassed.
- **Outbound:** real HTTPS through this environment's proxy. RDAP, the IANA bootstrap, and the
  government portals were queried live.
- **Fixtures:** files whose true content is known, so an answer can be checked against the input
  rather than against a 200 — a `.docx` with a named author and company, a 1×1 PNG, a plain-text
  file named `.png`, an RFC 5322 message, and a ZipCrypto archive with a known password.

**What this environment cannot do**, and therefore what no verdict below rests on: run a Container
(`SCAN_SERVICE`, `OCR_SERVICE`, `FILE_REPAIR_SERVICE`, `CONVERT` and `RECOVERY_SERVICE` are all
declared and all `[not connected]`), reach Cloudflare Browser Rendering with a full binding, or open
a raw TCP connection on port 43.

## The headline

| Classification                                           | Count |
| -------------------------------------------------------- | ----- |
| Works here, verified against an independent right answer | 11    |
| Works only once something is deployed                    | 7     |
| Broken by a defect rather than a missing deployment      | 1     |
| Could not be determined at all                           | 0     |

And the number that matters more than any of them:

> **Two of the nineteen tools have a page a person can open.** The WHOIS lookup and the network
> speed test. The other seventeen read `soon` on `/tools`
> (`apps/web/src/lib/tools/tool-presentation.ts`), and `apps/web/src/routes/(app)/tools/` contains
> exactly two tool routes. Eleven working backends are eleven things only a `curl` can reach.

The listing page is honest about this — nothing is faked, the badge says `soon` — so the register is
not lying to a member. It is the _ledger_ reader who can be misled, because a node at `shipped` with
`evidence:` naming a route reads as a delivered capability.

---

## Per-tool findings

Each section: what it needs at runtime that this repository cannot supply, what happened when it was
tried, the classification, and the evidence.

### 1. WHOIS Lookup (`whois-lookup`)

- **Route:** `GET /api/v1/whois` (`apps/worker/src/routes/tools/whois.ts`), permission `tools:whois`.
- **Package:** `@magna-carta/whois` — RDAP first via the IANA bootstrap, port-43 fallback for six
  ccTLDs. SSRF-guarded through `@magna-carta/integrations/safe-target`.
- **Needs at runtime:** outbound HTTPS to `data.iana.org` and the resolved RDAP server; outbound
  TCP/43 for the legacy path. No Container, no binding, no secret.
- **Classification:** **works here, verified correct** — and it is one of the two tools with a page.

Verified answers (each checkable against public record):

| Query            | Answer returned                                                                   |
| ---------------- | --------------------------------------------------------------------------------- |
| `example.com`    | registered 1995-08-14, registrar `RESERVED-Internet Assigned Numbers Authority`   |
| `cloudflare.com` | registered 2009-02-17, registrar `Cloudflare, Inc.`, five `NS*.CLOUDFLARE.COM`    |
| `nvbar.org`      | registered 1998-05-07, registrar `eNom, LLC`                                      |
| `sidn.nl`        | registered 1999-11-18, registrar `Stichting Internet Domeinregistratie Nederland` |
| `1.1.1.1`        | IP path, allocated 2011-08-10, status `active`                                    |
| `8.8.8.8`        | IP path, allocated 2023-12-28, status `active`                                    |

**Defect found, and fixed (see _What was repaired_).** A domain under a registry with neither an
RDAP bootstrap entry nor a port-43 host in the six-row table returned **`500 Internal Server Error`
with an Error ID**. Measured against the live IANA lists on the day of the audit: 1,438 TLDs, 1,200
covered by RDAP, 4 more by the port-43 table, **234 covered by neither** — including `.ch`, `.at`,
`.jp`, `.ru`, `.ae` and `.arpa`. One lookup in six sent a member to support over a registry that
simply does not answer machine queries.

**Two findings left as findings, not repaired:**

1. **The port-43 socket has no deadline.** `productionWhoisSocket` in `apps/worker/src/app.ts` opens
   `connect({ hostname, port: 43 })` and reads to EOF with no timeout and no abort. A `.de` lookup
   from here hung until the client gave up at 90 seconds. Here that is the environment (TCP/43 is
   not reachable through the proxy), so **the legacy ccTLD path is undetermined by this audit** — but
   the unbounded read is real code and a slow registry will reproduce it in production. Bounding it
   means choosing a deadline, which is a design call, not a typo.
2. **Two of the six port-43 rows are now dead.** `nl` and `fr` both publish RDAP today, so the
   bootstrap wins and their rows are never reached. Harmless; noted so nobody treats the table as
   current coverage.

### 2. Network Speed Test (`network-speed-test`)

- **Surface:** `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte` — the other tool
  with a page. The measurement engine is client-side (`@cloudflare/speedtest`) against the
  Cloudflare edge; the worker's part is two support routes.
- **Needs at runtime:** the edge (for the engine); `REALTIME_TURN_TOKEN_ID` /
  `REALTIME_TURN_TOKEN_SECRET` for the packet-loss measurement only.
- **Classification:** **works here, verified correct** (the authenticated-probe half).

`GET /api/v1/tools/connection` returned real edge facts for this session — `colo: IAD`,
`asn: 396982`, `asOrganization: "Anthropic, PBC"`, `country: US`. That is a right answer, verified by
being the actual network this audit ran on, and it is what the page's "round trip to Magna Carta"
figure is measured over.

`GET /api/v1/tools/turn-credentials` returned **`503 Relay measurement is not configured`** — the
secrets are unset. That is the route's own designed answer, not a fault: the page loses packet-loss
measurement and keeps everything else. Good behaviour, worth recording as expected rather than
letting a future reader treat the 503 as a break.

The bandwidth measurement itself runs in a browser against the edge and was **not** exercised here —
no browser, and the engine deliberately never touches our worker.

### 3. File Hash & Integrity (`file-hash-integrity`)

- **Route:** `POST /api/v1/file-integrity/hash` and `/verify`
  (`apps/worker/src/routes/files/file-integrity.ts`), permission `tools:fileIntegrity`.
- **Needs at runtime:** nothing outside the worker for the hash path; `env.R2` for the
  ingest-baseline compare.
- **Classification:** **works here, verified correct.**

Posted the 11 bytes `hello world`. All five digests were byte-identical to the host tools:

```
md5     5eb63bbbe01eeed093cb22bb8f5acdc3        == md5sum
sha1    2aae6c35c94fcfb415dbe95f408b9ce91ee846ed == sha1sum
sha256  b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9 == sha256sum
```

`sizeBytes: 11`, `expectedMatch: null`. This is the most straightforwardly correct tool in the set.

### 4. Metadata Inspector & Scrubber (`metadata-scrubber`)

- **Routes:** `POST /api/v1/metadata/inspect` and `/scrub`
  (`apps/worker/src/routes/files/metadata.ts`), permission `tools:metadataScrubber`. JSON body with
  base64 content, not `application/octet-stream`.
- **Needs at runtime:** nothing. In-worker OOXML/JPEG/PNG/TIFF handling.
- **Classification:** **works here, verified correct** — and verified on the removal, not just the
  report.

Fed a `.docx` carrying `dc:creator = Audit Author`, `cp:lastModifiedBy = Audit Reviewer`,
`cp:revision = 42`, `Company = Audit Firm LLP`, and the body text `Audit body text.`

- **Inspect** returned one high-risk finding, `identifying-metadata`, `clean: false`.
- **Scrub** returned `clean: true` and a rebuilt package. Unzipping it: `docProps/core.xml` and
  `docProps/app.xml` are reduced to empty root elements, no occurrence of `Audit Author` or
  `Audit Firm LLP` survives anywhere in the bytes, **and `word/document.xml` still carries
  `Audit body text.`** — the metadata went and the document did not.

### 5. File Decryption & Recovery (`file-decryption`)

- **Routes:** `POST /api/v1/decryption/inspect` and `/unlock`
  (`apps/worker/src/routes/files/decryption.ts`), permission `tools:decryption`, both audited, both behind
  an explicit `attestation.authorized` gate. Recovery lives on separate `/decryption/recover*`
  routes backed by `magna-carta-recovery`.
- **Needs at runtime:** nothing for inspect/unlock (`crates/decryption-core` compiled to WASM, built
  by `vp run bootstrap`). The `RECOVERY_SERVICE` worker + its Container for password recovery.
- **Classification:** **unlock works here, verified correct; recovery is deploy-gated.**

Built a ZipCrypto archive (`zip -P auditpass`) around the known plaintext
`secret payload for the audit`:

- **Inspect** returned `format: "zip"`, `hashcatMode: 17210` (the correct hashcat mode for PKZIP
  ZipCrypto, compressed), and a well-formed `$pkzip2$…$/pkzip2$` hash string — not an empty record.
- **Unlock** with the real password returned `filenameHint: "secret.txt"` and bytes that decode to
  exactly `secret payload for the audit`.
- An unencrypted `.docx` correctly refused with `400 The file is not encrypted`.

### 6. Email Inspector (`email-inspector`)

- **Route:** `POST /api/v1/email/inspect` (`apps/worker/src/routes/email/email-inspector.ts`), permission
  `tools:emailInspector`. Engine is `crates/email-core` as WASM.
- **Needs at runtime:** nothing (the WASM artifact, built by `vp run bootstrap`).
- **Classification:** **works here, verified correct**, with one caveat below.

Fed a hand-written RFC 5322 message. Every field came back matching the input: `messageIdentifier`
`audit-1@audit.example` with `provenance: "header"`, subject `Audit subject line`, `from`/`to` split
into display name and address, all seven raw headers in order, `sourceFormat: "eml"`,
`referencesRemoteContent: false`, and empty `integrity` arrays (the fixture is unsigned, so empty is
the right answer, not a blank record).

**Caveat, not repaired.** For a `text/plain`-only message the response carried the text body in
**both** `textBodies` and `htmlBodies`. That is `mail-parser`'s own fallback semantics surfacing
through `crates/email-core/src/eml.rs`, not a wiring mistake — but a reader of the report would
reasonably conclude the message had an HTML part when it had none, and `referencesRemoteContent` is
computed over `html_bodies`. Deciding what the field should mean is a design question; flagged, not
changed.

### 7. Firm Usage (`firm-usage`)

- **Route:** `GET /api/v1/firm-usage` (`apps/worker/src/routes/firm/firm-usage.ts`), permission
  `tools:firmUsage`, seeded to Owner/Admin by migration `0006_seed-tools-firm-usage`.
- **Needs at runtime:** nothing beyond the firm database.
- **Classification:** **works here; the counts half verified correct, the storage half undetermined.**

Against the seeded firm the route returned `matters: { total: 1, open: 1 }`, `files: 5`,
`fileVersions: 4`, `folders: 2`, `locations: 0` — matching what `seed-dev-firm` reported it created
(one matter, five files, two folders), with `fileVersions: 4` correctly excluding the seeded
quarantined file's version.

`storage` came back all zeros. That is **not** a defect: `readStorageUsage`
(`packages/file-manager/src/usage.ts`) sums the authoritative `storage_meter` rollup, which is
credited at ingest commit (`meterCommitStatements` in `file-service.ts`) and reconciled by a daily
Cron pass. The dev seeder inserts file rows directly and never traverses ingest, so there are no
meter rows to sum. **The storage half of this tool is therefore unverified by this audit** — it needs
a firm whose files arrived through the real upload path.

Worth naming for whoever builds the screen: a firm that uploads today sees its bytes when ingest
commits them, but a firm whose data was imported by any path that bypasses ingest sees zero until the
daily reconciliation runs.

### 8. Property Listing Links (`property-listing-links`)

- **Package:** `@magna-carta/property-links` — a pure link generator, five providers. No route.
- **Needs at runtime:** nothing. It emits URLs; the member's browser does the rest.
- **Classification:** **works here, partly verified** — see the honest gap below.

For `500 S Grand Central Pkwy, Las Vegas, NV 89155` (county FIPS `32003`, APN `139-33-501-002`) all
five providers built a link:

| Provider        | Live check                                            |
| --------------- | ----------------------------------------------------- |
| Redfin          | `200`                                                 |
| Google Maps     | `200`                                                 |
| County Assessor | `200` **and the right parcel** — see the next section |
| Zillow          | `403` — bot mitigation against a non-browser client   |
| Realtor.com     | `429` — bot mitigation against a non-browser client   |

**Zillow and Realtor.com are undetermined from here.** A `403`/`429` to `curl` is what those sites
return to any non-browser client; it is not evidence the URL is wrong, and it is not evidence it is
right. Both URLs match each site's documented search-slug shape. Settling it needs a real browser.

**One behaviour worth knowing before this gets a page.** `formatAddress` needs a street plus at
least one of city/postal, and the providers degrade quietly: called with a partial address the
Zillow/Redfin/Maps links come back **without the state and ZIP**, which is how a Las Vegas address
becomes a search that matches a different Las Vegas. The UI has to require the structured address,
not merely accept what it has. Realtor.com is stricter and returns `null` when any of
street/city/region/postal is missing — the safer behaviour of the two.

### 9. County Property Records (`county-property-records`)

- **Package:** `@magna-carta/government-links` (`property/`). Pure link generator, no route.
- **Classification:** **works here, verified correct — within its coverage, which is narrow.**

`assessorUrl` for Clark County NV with APN `139-33-501-002` produced

```
https://maps.clarkcountynv.gov/assessor/AssessorParcelDetail/ParcelDetail.aspx?hdnParcel=13933501002
```

Fetching that URL returns the real Clark County parcel detail page and the page's own body carries
`139-33-501-002` and `Clark County Real Property`. The separator-stripping normalization is correct
and the deep link resolves to the parcel it claims. A deliberately non-existent APN returned the
county's own _"No record found for your selection"_ page — so a wrong APN degrades to a truthful
county page, not to a broken link.

**The coverage is the finding.** Measured off the registry: **835 assessor sites across 22
jurisdictions** — `AK AZ CA CO DE DC HI ID KS MT NE NV NM ND OK OR SD UT WA WY GU VI` — plus **17
recorder sites and zero GIS sites**. That is Nevada and the Mountain West done thoroughly and **none
of Texas, Florida, New York, Illinois, Pennsylvania, Ohio, Georgia, North Carolina, Michigan or New
Jersey**. For a firm outside those 22, this tool has nothing to offer. The ledger node carried no
coverage note; it does now.

### 10. Business Entity Lookup (`business-entity-lookup`)

- **Package:** `@magna-carta/government-links` (`business/`). Pure link generator, no route.
- **Classification:** **works here, verified correct.** 51 jurisdictions (50 states + DC).

Live-checked two:

- Nevada → `https://esos.nv.gov/EntitySearch/OnlineEntitySearch` — `200`, the real Nevada SOS entity
  search.
- Delaware → `https://icis.corp.delaware.gov/ecorp/entitysearch/NameSearch.aspx` — `200`, the real
  Delaware Division of Corporations name search.

These are search-page links, not deep links, so "a right answer" here means the link lands on the
correct official registry search — which it does.

### 11. Attorney License Lookup (`attorney-license-lookup`)

- **Package:** `@magna-carta/government-links` (`licensing/`). Pure link generator, no route.
- **Classification:** **works here, verified correct.** 51 jurisdictions.

Live-checked two:

- Nevada → `https://nvbar.org/find-a-lawyer/` — `200`.
- California → `https://apps.calbar.ca.gov/attorney/LicenseeSearch/QuickSearch` — `200`, the State
  Bar of California licensee search.

This is the best-documented data set in the area:
[`docs/research/attorney-license-lookup-coverage.md`](attorney-license-lookup-coverage.md) records
that 49 of the 51 are real name-or-bar-number searches and names the two (New Hampshire, South
Dakota) that publish no instant search, with the authority proving it. That document is what makes
this tool trustworthy rather than merely present.

### 12. Shipping & Postage (`shipping`)

- **Routes:** `apps/worker/src/routes/communications/shipping.ts` — connect/disconnect, create shipment, rates,
  purchase, label, tracking, refund. Permission `integrations:manage`.
- **Package:** `@magna-carta/shipping` (EasyPost behind a typed port).
- **Needs at runtime:** a firm EasyPost API key stored as a firm secret, and a way to read it back.
- **Classification:** **BROKEN BY A DEFECT, not by a missing deployment.** The only one in the set.

`POST /api/v1/shipments` accepted a draft and returned `201 { id: shipment_… }` with no carrier
connected at all. `POST /api/v1/shipments/{id}/rates` then returned **`500 Internal server error`**.
The captured cause:

```
firm_secret credential read is not yet wired (the marketplace slice wires it)
```

That string is thrown by `firmSecretStoreNotYetAvailable` in
`apps/worker/src/plugins/secret-store.ts`, which is the production `SecretStore` builder for **every**
plugin. So the credential read is an **unbuilt seam**, not an unset secret and not an undeployed
worker: connecting a real EasyPost account and deploying every worker in the repository would not
change this outcome. Rate-shopping, label purchase, tracking and refund all route through it.

Two consequences worth stating plainly:

1. **A person can create a shipment that can never be rated or bought.** The draft write succeeds
   before anything checks that a carrier connection exists.
2. **The failure is a 500 with an Error ID**, so it reads as our fault to whoever hits it, when the
   truthful answer is "postage is not connected yet". The route already declares a `502` for
   provider unavailability; mapping the unwired credential read onto a clean refusal is more than a
   one-line change (it means giving the seam a typed absence rather than a throw), so it is left as
   a finding.

The parent ledger node already said `live firm secret deferred`. The `easypost-adapter` child, at
`shipped`, did not; it does now.

**Resolved the same day, in the form this finding named.** The seam was given the typed absence: the
integration framework's `Dispatch` gained a fourth reason, `credential-store-not-implemented`,
`SecretStoreForFirm` returns `SecretStore | null` instead of throwing, and shipping maps the outcome
to `501 not-implemented`. Connecting a postage account now refuses first and by name — it was a
`500` too, which this finding did not exercise, and it is the one act a member would have reached
for. The credential read itself is still unbuilt, so the classification above stands; what changed is
that its absence is legible instead of fatal. Draft creation still succeeds, deliberately: a draft is
the firm's own addresses and parcel and needs no carrier.

### 13. Safe Website Viewer (`safe-website-viewer`)

- **Route:** `POST /api/v1/safe-browse` (`apps/worker/src/routes/tools/safe-browse.ts`), permission
  `tools:safeBrowse`.
- **Needs at runtime:** the Cloudflare **Browser Rendering** binding (`env.BROWSER`) with
  `quickAction()`, which needs `compatibility_date >= 2026-03-24` (satisfied) **and** the account
  entitlement.
- **Classification:** **works only once deployed** — and the deploy step is an account entitlement,
  not a worker.

`POST /api/v1/safe-browse` with `{"url":"https://example.com/"}` returned `500`. The captured cause:

```
TypeError: The RPC receiver does not implement the method "quickAction".
```

Miniflare exposes a `BROWSER` binding locally but not that method, so the renderer cannot be
exercised here at all. The SSRF guard and redirect probe in front of it are separately covered by the
package's own tests. Note the route declares a `502` for renderer unavailability but a binding that
lacks the method escapes as a `500`; against a real binding that path does not arise, so it is
recorded rather than changed.

**This tool has no entry in `docs/deploy-queue.md`.** Browser Rendering is the one dependency in this
catalog that is neither a worker nor a container nor a secret, so it is the easiest to forget. Added.

### 14. File Type Verifier (`file-type-verifier`)

- **Route:** `POST /api/v1/file-type/verify` (`apps/worker/src/routes/files/file-type.ts`), permission
  `tools:fileTypeVerifier`.
- **Needs at runtime:** `SCAN_SERVICE` → `magna-carta-scan`, whose Container serves `POST /identify`
  (Magika/ONNX). Confirmed present at `containers/scan/src/lib.rs` (`.route("/identify", post(identify))`).
- **Classification:** **works only once deployed** — `magna-carta-scan` must be redeployed carrying
  `/identify`.

Posted a plain-ASCII file named `mislabelled.png`. The answer was
`503 Identification failed` — the binding exists locally but is `[not connected]`, so the fetch
returns an error status and the route degrades as designed.

The half that can be checked without the engine is the report builder, and it is sound.
`buildFileTypeReport` (`packages/file-type/src/report.ts`) distinguishes four outcomes and only says
`unverifiable` in two narrow cases — the engine returned an unknown label, or it returned a type for
which no canonical extension is held. A detected type with a known extension list always resolves to
`match` or `mismatch`. So the "says unverifiable for every input" failure mode this audit was asked
to look for is **not** latent here; the risk is confined to how broad Magika's unknown-label set
turns out to be in practice, which needs the engine to measure.

### 15. Malware Scan (`malware-scan`)

- **Route:** `POST /api/v1/scan/diagnose` (`apps/worker/src/routes/files/scan-diagnose.ts`), permission
  `firm:scanFile`, audited.
- **Needs at runtime:** `SCAN_SERVICE` → `magna-carta-scan` (clamd + yara-x + structural heuristics).
- **Classification:** **works only once deployed.**

Posted `hello world`. The answer was **`500 Internal server error`**, cause
`scan container returned status 503`.

This is worth reading carefully, because the route's own description promises something else:

> Returns an honest `unscanned` verdict until the scan Container is activated (the engine-less
> adapter never reports a false `clean`).

That promise holds only when `env.SCAN_SERVICE` is **absent** — `resolveScanPort`
(`apps/worker/src/files/scan-port-binding.ts`) picks the engine-less adapter on absence alone. The
binding is _declared_ in `wrangler.jsonc`, so it is present-but-unreachable both here and in any
deployment where `magna-carta-scan` is a placeholder or unhealthy, and the adapter throws instead.
The 500 is the documented behaviour for a bound-but-faulty engine (`computeVerdict` is meant to treat
a deployed-but-unavailable engine as a fault, never a verdict), so this is **not** a defect — but the
description promising `unscanned` describes a configuration that cannot occur once the binding is
declared, and the sibling file-type route degrades to a clean `503` on the identical condition.
Recorded as an inconsistency for whoever next opens the scan area; not changed here, because
choosing between "fault" and "unscanned" for an unreachable engine is a safety decision, not a typo.

### 16. Text Recognition / OCR (`ocr`)

- **Routes:** `POST /api/v1/ocr` and `/ocr/searchable` (`apps/worker/src/routes/files/ocr.ts`), permission
  `tools:ocr`.
- **Needs at runtime:** `OCR_SERVICE` → `magna-carta-ocr` (`apps/ocr-worker` + `containers/ocr`,
  PP-OCR ONNX via `crates/ocr-core`).
- **Classification:** **works only once deployed** — and the deploy step **was not recorded anywhere.**

Posted a PNG: `503 Recognition failed`. Expected with the binding unconnected.

**The real finding is a documentation gap with teeth.** `apps/worker/wrangler.jsonc` declares
`OCR_SERVICE → magna-carta-ocr`, and per
[`operations.md`](../conventions/operations.md) _Placeholder service workers_, **Cloudflare rejects a
deploy whose service binding names a Worker that does not exist**. `magna-carta-ocr` appears in:

- neither the seven Workers Builds connections listed in `operations.md`
  (`magna-carta`, `-scan`, `-bundle`, `-recovery`, `-file-repair`, `-status`, `-edit`),
- nor the placeholder list (`magna-carta-bundle`, `magna-carta-convert`),
- nor `docs/deploy-queue.md`, anywhere.

So either the worker exists and no record says so, or it does not exist and **the next app-worker
deploy is rejected outright** — which would block every tool in this catalog, not just OCR. This
audit cannot tell which from here (no Cloudflare credentials). Added to the deploy queue as a check
to perform before the next push, since it is cheap to confirm and expensive to discover.

### 17. File Repair & Salvage (`file-repair`)

- **Routes:** `POST /api/v1/file-repair/diagnose`, `/repair`, `/carve`, and the two `/attach`
  variants (`apps/worker/src/routes/files/file-repair.ts`), permission `tools:fileRepair`.
- **Needs at runtime:** `FILE_REPAIR_SERVICE` → `magna-carta-file-repair`
  (`apps/file-repair-worker` + `containers/file-repair`, `crates/recovery-core`).
- **Classification:** **works only once deployed.**

`POST /api/v1/file-repair/diagnose` returned `503 Diagnosis failed` — the designed degradation.

The worker **is** connected to Workers Builds per `operations.md`, so this is a straightforward
"deploy it" rather than a missing project. `operations.md` already carries a live correction worth
not losing: the build watch path is `containers/file-repair-worker/*` while the container lives at
`containers/file-repair/`, **so no path matches it and a change to the repair image never triggers a
rebuild.** That is a real trap — the worker would redeploy without the engine change.

### 18. File Converter (`file-converter`)

- **Routes:** `POST /api/v1/conversions/upload`, `POST /api/v1/conversions`,
  `GET /api/v1/conversions/{jobId}` (+ `/events`), permission `tools:fileConverter`.
- **Needs at runtime:** `CONVERT` → `magna-carta-convert` and its `RasterEngineContainer`;
  `libreoffice`, `email` and `ffmpeg` engines resolve to the deferred port regardless.
- **Classification:** **works only once deployed** (orchestration verified; engine not).

What was verified: `POST /conversions/upload` minted a job id, an upload URL and a dimension-stamped
header set; `POST /conversions` accepted the job (`202 { status: "queued" }`); the queue consumer ran
and `GET /conversions/{jobId}` answered a clean terminal state. The Durable Object, queue, consumer
and poll are all genuinely working.

What could **not** be verified, and why it is worth writing down: the source upload cannot be
completed under `wrangler dev` at all. The dev upload route
(`apps/worker/src/routes/developer/dev-r2-upload.ts`) only accepts a key that `uploads.initiate` minted as a
pending **file version**, and a conversion source key is minted by `conversions/upload` and never
registered there — so the PUT answers `404 No pending upload in this firm has that object key`, and
the job correctly fails `source expired`. In production the upload URL is a presigned R2 URL and this
does not arise. **The consequence is that no local run can ever exercise this tool end to end**, even
after the engine ships; closing that needs a second dev-upload lane or registration of conversion
sources, which is a design call.

`magna-carta-convert` is currently a 503 placeholder (`operations.md` §14) and the LibreOffice engine
activation is already queued in `docs/deploy-queue.md`.

### 19. AI-Text Detection (`ai-text-detection`)

- **Route:** `POST /api/v1/ai-detection/detect` (`apps/worker/src/routes/files/ai-detection.ts`),
  permission `tools:aiTextDetection`. The only `integration`-backed tool besides shipping.
- **Needs at runtime:** the firm's own consent setting **and** a platform `PANGRAM_API_KEY` secret.
- **Classification:** **works only once deployed** (the secret is the deploy step).

Posted a passage with the firm's setting untouched: `422 External AI-text detection is disabled` —
"Enable external detection in firm settings before using this tool." That is a correct and
well-placed consent gate: it refuses **before** any provider call, so no client text leaves the
platform on a firm that has not opted in. With the setting on and no key configured, the code path
refuses just as honestly (`422 Detection unavailable`) rather than constructing a dead adapter.

Nothing here is broken. It needs a secret and a firm decision, in that order.

---

## What was repaired

One repair, chosen because it was small, certain, and visible to a person.

**A WHOIS lookup for an unsupported registry answered `500` instead of saying so.**

- `packages/whois/src/legacy.ts` — `queryLegacy` now throws a typed `UnsupportedRegistry` (carrying
  the TLD) instead of a bare `Error` whose message named an internal source path. Exported from the
  package root.
- `apps/worker/src/routes/tools/whois.ts` — catches it and answers `501 not-implemented`: _"The '.ch'
  registry publishes no lookup service this tool can reach. Check the registry's own WHOIS page
  directly."_ The TLD is echoed because a public suffix is not user input; the query string still
  never is.
- `apps/web/src/lib/tools/whois/whois-lookup.ts` — `problemGuidance` classifies `501` **before** the
  `>= 500` band. Without this the fix would have been invisible: the page shows the Error ID only on
  a `danger` tone, so a 501 would still have read as our fault with a code to quote at support.
- Tests: `packages/whois/test/legacy.test.ts` (typed throw, socket never opened),
  `apps/worker/test/whois-route.test.ts` (501 + problem type + the TLD in the detail),
  `apps/web/test/whois-lookup.test.ts` (501 is `info`, message does not mention support).
- Contract: `apps/worker/openapi/openapi.json` and `packages/api-client/src/types.gen.ts`
  regenerated.

Verified live against the running worker: `admin.ch` → `501` with the new problem document;
`example.com` → unchanged `200` with the same registration record as before.

## What was deliberately not repaired

Each of these is real, and each is larger than a typo.

| Finding                                                             | What it would take                                                                |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Shipping's rate/purchase/track/refund 500 on an unwired secret read | Give `SecretStore` a typed absence and map it to a refusal — the marketplace seam |
| `productionWhoisSocket` has no read deadline                        | Choose and justify a timeout; bound the response size too                         |
| Email inspector reports an HTML body for a `text/plain` message     | Decide what `htmlBodies` means, then change the engine or the field name          |
| `scan/diagnose` 500s where `file-type` 503s on the same condition   | A safety decision: is an unreachable engine a fault, or an `unscanned` verdict?   |
| Conversions cannot be exercised under `wrangler dev`                | A second dev-upload lane, or register conversion sources as pending objects       |
| Property links drop state/ZIP on a partial address                  | A UI contract requiring the structured address (the tool has no UI yet)           |

## Ledger corrections made

Read against `roadmap.d/README.md`: `shipped` legitimately covers a backend-only capability **with a
note**. So nothing was downgraded for needing a deploy. What was wrong was silence — nodes whose
note did not tell the truth about what a person gets today. Notes added or corrected in
`roadmap.d/integrations.md`; `vp run register-build` re-run.

## Deploy-queue additions

Recorded in `docs/deploy-queue.md`, in the order they have to happen. Checked against what was
already there first — the LibreOffice/convert, search, bundle, sign and email-capture steps were
already queued and are not duplicated here.

1. **Confirm `magna-carta-ocr` exists** — before anything else, because a service binding naming a
   missing Worker rejects the whole app-worker deploy.
2. **Deploy `magna-carta-scan`** carrying `/identify` — unblocks both the malware scan and the file
   type verifier.
3. **Deploy `magna-carta-file-repair`** — and fix its build watch path first, or the image never
   rebuilds.
4. **Enable Browser Rendering** on the account — the safe website viewer's only dependency.
5. **Set `PANGRAM_API_KEY`** — AI-text detection, after a firm opts in.

## The question behind the exercise

**Would a firm reach for these, or were some shipped because they were easy?**

Honestly: both, and the split is legible.

**Tools a firm reaches for.** The metadata scrubber is the clearest — scrubbing a document before it
goes out the door is a malpractice-adjacent habit, it works today, and it works correctly on the
removal and not just the report. File hash and integrity is the second: chain-of-custody over a
produced file is a thing a litigator is actually asked to attest to, and it returns exact digests.
File decryption is the third and the most distinctive — a client sends a locked PDF or ZIP and
nobody in the firm has the password; that is a real Tuesday, and the tool produced a correct hashcat
hash and a correct unlock. Attorney licence lookup earns its place not because linking to a bar
directory is hard but because somebody verified all 51 jurisdictions by hand and wrote down the two
that cannot be searched. Email inspector and the malware scan both serve a specific fear — a client
forwards something suspicious — and that fear is common.

**Tools that look like they were easy.** Property listing links is four URL templates; it is
genuinely useful for a real-estate practice and genuinely trivial to build, which is a fine reason to
have it but not evidence anybody asked. County property records is the same shape with more work
behind it, and its coverage says where the demand actually was: Nevada and the Mountain West are
thorough, and the ten largest states outside California are absent — that is a tool built for one
firm's jurisdiction, which is honest but should be labelled. The network speed test is the one I
would question hardest: it is the most finished tool in the catalog, with its own page, per-direction
charts and an AIM score, and the question it answers — "is my internet slow?" — is one every operating
system and a dozen free websites already answer. It is a beautifully built diagnostic for a problem
nobody brings to their practice-management vendor. Firm usage is close behind: a storage read-out is
easy to build and is the sort of thing a firm looks at once.

**The uncomfortable one is the shape of the whole area.** Nineteen manifests, eleven working
backends, two pages. The catalog was built as a catalog first — the IA, the grouping, the contextual
tags, the connection-health seam — and the tools were filled in behind it. That ordering is why the
easiest tools are the finished ones: the speed test and the WHOIS lookup got pages because they were
the cheapest to give a page to, not because they were the two most wanted. A firm that opened
`/tools` today would see seventeen tiles marked `soon`, two of which it might use, and would form a
view of the product from that ratio.

Nothing in the catalog is dishonest. But the eleven backends that already return right answers —
metadata, hashing, decryption, email inspection — are worth more than a twelfth backend, and each of
them is one page away from being a tool a firm would reach for.
