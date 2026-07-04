#!/usr/bin/env bash
# Runs hashcat's built-in benchmark (`-b`) for the full baseline mode set and prints ONE JSON
# object to stdout matching the `BenchmarkResult` envelope the gpu-benchmark package parses
# (packages/gpu-benchmark/src/bench-parse.ts). `-b` needs no hash or wordlist input, so no
# password is ever cracked and nothing sensitive is produced or logged.
#
# The mode set covers the three GPU-bound formats (9600 Office 2013+, 10700 PDF 1.7 Level 8,
# 11600 7-Zip) plus the older/CPU-band formats (9400/9500 legacy Office, 10500 old PDF, 13600
# WinZip-AES, 17200 PKZIP/ZipCrypto) so every format the recovery service can attempt has a
# measured rig throughput on file, even where production runs it on the CPU rung instead.
set -euo pipefail

modes=(9400 9500 9600 10500 10700 11600 13600 17200)

# hashcat's benchmark mode (`-b --machine-readable`) prints one colon-delimited line per compute
# device, e.g. `1:0:1683:4513:55.02:10240000000` — the LAST field is that device's speed in
# hashes/sec (10240000000 above, ~10.24 GH/s). A multi-GPU rig prints one such line per device for
# each mode; this sums the last field across every line to get the rig's total hashes/sec for the
# mode. Any line whose last field isn't a positive number (blank line, header, stray warning) is
# ignored rather than counted. If a mode produces zero parseable lines, this prints nothing and
# the caller is expected to treat that as "not measured" rather than a measured zero.
sum_device_speeds() {
  awk -F: '
    {
      last = $NF
      if (last ~ /^[0-9]+(\.[0-9]+)?$/ && last + 0 > 0) {
        total += last
        count++
      }
    }
    END {
      if (count > 0) print total
    }
  '
}

gpu_line=$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | head -n1)
gpu_name=$(printf '%s' "$gpu_line" | cut -d',' -f1 | sed 's/^ *//; s/ *$//')
gpu_count=$(nvidia-smi --query-gpu=name --format=csv,noheader | wc -l | tr -d '[:space:]')
gpu_ram_field=$(printf '%s' "$gpu_line" | cut -d',' -f2 | sed 's/^ *//; s/ *$//')
gpu_ram_megabytes=$(printf '%s' "$gpu_ram_field" | awk '{print $1}')

throughput_json="[]"

for mode in "${modes[@]}"; do
  if mode_output=$(hashcat -b -m "$mode" --machine-readable --quiet 2>/dev/null); then
    hashes_per_second=$(printf '%s\n' "$mode_output" | sum_device_speeds)
    if [[ -z "$hashes_per_second" ]]; then
      # The mode ran but no line had a parseable positive last field — the output format didn't
      # match what this rig's hashcat version emits. Omit the mode rather than reporting a
      # measured-looking 0: an absent mode reads downstream as "not measured", a 0 would read as
      # "measured, and the rig is worthless for this format," which is false and dangerous for
      # cost-per-work ranking.
      echo "run-benchmark: hashcat mode $mode produced no parseable speed line, omitting from output" >&2
      continue
    fi
    throughput_json=$(jq --argjson hashcatMode "$mode" --argjson hashesPerSecond "$hashes_per_second" \
      '. + [{"hashcatMode": $hashcatMode, "hashesPerSecond": $hashesPerSecond}]' <<<"$throughput_json")
  else
    # A mode unsupported on this rig (missing kernel, driver mismatch, etc.) is skipped rather
    # than aborting the whole benchmark — the envelope is still valid with the modes that ran.
    echo "run-benchmark: hashcat mode $mode failed on this rig, skipping" >&2
  fi
done

jq -n \
  --arg gpuName "$gpu_name" \
  --argjson gpuCount "$gpu_count" \
  --argjson gpuRamMegabytes "$gpu_ram_megabytes" \
  --argjson throughput "$throughput_json" \
  '{gpuName: $gpuName, gpuCount: $gpuCount, gpuRamMegabytes: $gpuRamMegabytes, throughput: $throughput}'
