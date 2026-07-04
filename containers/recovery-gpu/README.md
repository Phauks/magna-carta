# Recovery GPU benchmark image

Measures raw hashcat throughput on a rented GPU rig, so the platform can rank rig offers by
dollars-per-work before committing spend to a real recovery run. The image runs hashcat's
built-in benchmark (`-b`) across the full baseline hashcat-mode set and prints one JSON envelope
that `packages/gpu-benchmark/src/bench-parse.ts` (`parseBenchmarkJson`) consumes.

hashcat is a C/C++ tool. It runs only inside this container, on rented GPU hardware the firm does
not control, and is never linked into the TypeScript or Rust codebase (see the Dockerfile's top
comment).

## Build

Build context is the **repository root** — `containers/recovery-gpu/Dockerfile` copies
`containers/recovery/wordlists/` by a repo-root-relative path, mirroring
`containers/recovery/Dockerfile` (the CPU-rung recovery image).

```
docker build -f containers/recovery-gpu/Dockerfile -t mc-recovery-gpu .
```

## Run

The container needs an NVIDIA GPU and the NVIDIA Container Toolkit on the host (rented GPU rigs
provision this already):

```
docker run --rm --gpus all mc-recovery-gpu
```

The entrypoint (`bench/run-benchmark.sh`) runs `hashcat -b -m <mode> --machine-readable --quiet`
for every mode in `9400 9500 9600 10500 10700 11600 13600 17200`. That output is colon-delimited,
one line per compute device, with the speed in hashes/sec as the LAST field (e.g.
`1:0:1683:4513:55.02:10240000000` is ~10.24 GH/s on one device); the script sums the last field
across all of a mode's device lines to get the rig's total hashes/sec for that mode. It also reads
the GPU name and total VRAM from `nvidia-smi`, and prints a single JSON object to stdout — nothing
else. `-b` needs no hash or wordlist input, so no password is ever cracked and nothing sensitive is
produced or logged. If a mode produces no parseable speed line, the script warns on stderr and
omits that mode from the JSON rather than reporting a false `0`.

## Ops: verifying real output

The exact machine-readable field layout can vary slightly by hashcat version, so at the first real
run on a rig, sanity-check the emitted numbers before trusting them for cost-per-work ranking:

- Every reported `hashesPerSecond` should be non-zero and in a plausible order of magnitude for the
  format — e.g. mode 10500 (old PDF) should land around 10^8 H/s, and mode 9600 (Office 2013+)
  around 10^4-10^5 H/s, on a single RTX 4090.
- If any mode is missing from the output, or its number looks implausible (too low, too high, or
  suspiciously round), run `hashcat -b -m <mode> --machine-readable` directly on the rig, inspect
  one raw device line, and confirm the last colon-delimited field is still the speed — adjust
  `bench/run-benchmark.sh` if that hashcat version's layout has shifted.

## Publish

Push the built image to the registry the rented rig pulls from, then point the rig's launch
command at it. The rig owner runs this manually against real hardware — it is not part of any
automated build pipeline.

## `bench/sample-output.json`

A hand-authored example envelope used only by
`packages/gpu-benchmark/test/envelope-contract.test.ts` to prove the entrypoint's JSON shape
parses with `parseBenchmarkJson`. Every `hashesPerSecond` value in it is an illustrative
placeholder, not a measurement from real hardware — the actual numbers come from running this
image on a rented GPU.

## Wordlists (bundled for parity with the CPU-rung recovery image)

The wordlists under `containers/recovery/wordlists/` are baked into this image too, for parity
with the production recovery service — this benchmark's own hashcat runs use `-b` and touch no
wordlist. License attributions (mirrored from `containers/recovery/wordlists/NOTICES.md`):

- **`ncsc-100k.txt`** — UK National Cyber Security Centre "Have I Been Pwned" Top 100,000
  passwords, distributed via SecLists. Contains public sector information licensed under the
  [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
- **`10k-most-common.txt`** — SecLists Common Credentials, copyright Daniel Miessler, Jason
  Haddix, and contributors, licensed under the
  [MIT License](https://github.com/danielmiessler/SecLists/blob/master/LICENSE).
- **`best64.rule`** — the hashcat project's `best64.rule`, copyright 2015-2024 hashcat project
  contributors, licensed under the MIT License.
