# The GPU benchmark image: measures raw hashcat throughput on a rented GPU rig so the platform can
# rank rig offers by dollars-per-work before committing spend to a real recovery run. hashcat is a
# C/C++ tool; it runs ONLY inside this container, on rented GPU hardware we do not control, and is
# never linked into our TypeScript or Rust codebase.
#
# Build context: the repository root (the COPY paths below are repo-root-relative, mirroring
# containers/recovery/Dockerfile). Example: docker build -f containers/recovery-gpu/Dockerfile -t
# mc-recovery-gpu .

FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

RUN apt-get update \
 && apt-get install -y --no-install-recommends hashcat jq ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/recovery-gpu

# The wordlists are baked in for parity with the production recovery rung (containers/recovery) —
# this benchmark's own hashcat runs use `-b` (hashcat's built-in benchmark) and touch no wordlist.
COPY containers/recovery/wordlists/ ./wordlists/
COPY containers/recovery-gpu/bench/ ./bench/

ENTRYPOINT ["/opt/recovery-gpu/bench/run-benchmark.sh"]
