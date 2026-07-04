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

# Sums the per-device "SPEED" values from one hashcat --machine-readable status line, using the
# same tokenizing rule as sumDeviceSpeeds in packages/gpu-benchmark/src/bench-parse.ts: read
# "<hashes> <milliseconds>" pairs following the SPEED token, summing the hashes, and stop at the
# first pair that is not purely numeric. hashcat repeats the pair once per device, and periodic
# status lines repeat across a run, so this keeps the LAST line's total as the mode's throughput.
sum_device_speeds() {
  awk '
    {
      speed_index = 0
      for (i = 1; i <= NF; i++) {
        if ($i == "SPEED") { speed_index = i; break }
      }
      if (speed_index == 0) next
      total = 0
      i = speed_index + 1
      while (i + 1 <= NF) {
        hashes = $i
        milliseconds = $(i + 1)
        if (hashes !~ /^[0-9]+$/ || milliseconds !~ /^[0-9]+$/) break
        total += hashes
        i += 2
      }
      last_total = total
    }
    END { print last_total + 0 }
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
