# Scan engine harness

A local, browser-based way to watch the malware-scan container actually work: fire crafted trigger
files at the live engine, see the verdict it returns, and time how long a scan takes — including a
streaming benchmark for multi-gigabyte payloads.

This is a developer diagnostic. It runs the **real** Rust + ClamAV + YARA engine in Docker and talks
to it over the same `/scan` contract the Worker uses. Nothing here is product code, and it changes
nothing about how the container ships.

## Why Docker (and not the local Worker)

The scan engine is a Cloudflare Container. The local Worker dev runtime (Miniflare) cannot run
container bindings, so under `vp run worker-dev` the `SCAN_CONTAINER` binding is absent and every
upload commits as `unscanned / no-engine` — the pipeline works end to end, but nothing is actually
scanned. To see triggers caught and measure real scan speed, the engine has to run in Docker (here) or
be deployed.

## What it measures (and what it does not)

Scanning is **asynchronous**: an upload returns immediately, the bytes land in R2, an R2 event drives
the ingest consumer, and only when the scan returns `clean` is the version committed and downloadable.
This harness times the **scan step in isolation** — the dominant, most variable part. It does not
include R2 upload time or queue pickup latency. For a true end-to-end "upload → usable" wall-clock,
deploy and test through the real app.

## Prerequisites

- Docker Desktop **running** (the engine image is `linux/amd64`; Docker Desktop virtualizes it on
  Windows/macOS).
- Node 20+ (for the sample generator and proxy — both dependency-free).

## Run it

From `containers/scan`:

```sh
# 1. Build the engine image (first build is slow: Rust release compile + ClamAV signature database).
docker build -t magna-carta-scan .

# 2. Run it, exposing the service on :8080.
docker run --rm -p 8080:8080 --name magna-carta-scan magna-carta-scan
```

From `containers/scan/harness` (in a second terminal):

```sh
# 3. Generate the trigger corpus (writes ./samples, gitignored).
node generate-samples.mjs

# 4. Start the harness proxy and open the page.
node scan-proxy.mjs
#    -> http://127.0.0.1:8787
```

The page shows the engine status (green when the container is reachable), a button per trigger sample
with its expected verdict, a drag-and-drop box for any file, and the large-file benchmark.

## The trigger corpus

`generate-samples.mjs` builds each file to drive one verdict path. The expected verdict is shown beside
each button and recorded in `samples/manifest.json`.

| Sample              | Drives                          | Expected verdict                      |
| ------------------- | ------------------------------- | ------------------------------------- |
| `eicar.com`         | ClamAV signature database       | `infected` (Eicar-Test-Signature)     |
| `clean.txt`         | nothing                         | `clean`                               |
| `active.pdf`        | PDF `/OpenAction` + JavaScript  | `clean` + active content              |
| `macro.docx`        | OOXML `vbaProject.bin` part     | `clean` + active content              |
| `bomb-ratio.zip`    | declared/compressed ratio > 100 | `suspicious / decompression-bomb`     |
| `nested-deep.zip`   | ~20 archives deep (cap 16)      | `suspicious / archive-nesting`        |
| `many-entries.zip`  | > 10,000 entries                | `suspicious / archive-entry-count`    |
| `encrypted.zip`     | encrypted entry (cannot read)   | `unscanned / encrypted`               |

## The 1 GB question — and a measurement caveat

clamd sets the pace (YARA and the heuristics are comparatively free and short-circuit instantly for a
non-archive). Measured **directly inside the container** (`clamscan` on a file, no network), clamd scans
at **~60 MiB/s on this host — about 16 s of scan work for 1 GiB.**

The browser benchmark's end-to-end number is **not** that, and is unreliable on a local Docker-Desktop /
WSL2 host: the Node → container → clamd loopback transport dominates and swings wildly run to run (it has
reported anywhere from ~8 to ~40 MiB/s for the same bytes, sometimes non-monotonic in size). Treat the
benchmark as a smoke test that large files are **accepted and scanned**, not as the production scan rate —
that depends on Cloudflare's worker ↔ container transport, which cannot be measured here. The
`clamscan`-direct figure is the trustworthy engine number. And scanning is asynchronous, so this latency
is background work, never a user-blocking wait.

Two real engine settings the harness validated, both shipped:

- **INSTREAM chunk size.** The client streams to clamd in 1 MiB chunks (`src/clamav.rs`), raised from the
  library's 4 KiB default — at 4 KiB a 1 GiB scan was ~260k tiny framed writes.
- **clamd scan-size limits.** `entrypoint.sh` raises `StreamMaxLength` / `MaxScanSize` / `MaxFileSize` to
  `2048M` (= the 2 GiB inspectable cap); clamd's stock 25M / 100M limits would refuse anything larger over
  INSTREAM. For a one-off different ceiling without rebuilding:

  ```sh
  docker run --rm -p 8080:8080 --entrypoint bash magna-carta-scan -c \
    'printf "StreamMaxLength 2048M\nMaxScanSize 2048M\nMaxFileSize 2048M\n" >> /etc/clamav/clamd.conf && exec /usr/local/bin/entrypoint.sh'
  ```

Raising these makes clamd hold and scan up to that many bytes, so the production ceiling is the container
instance's memory — size it for a full-size scan (the service buffers the body, clamd its own copy, atop
the resident signature DB).

## Files

- `generate-samples.mjs` — builds the trigger corpus (dependency-free ZIP/PDF writers).
- `scan-proxy.mjs` — static server + same-origin proxy to the container; hosts the large-file benchmark.
- `harness.html` — the browser UI.
