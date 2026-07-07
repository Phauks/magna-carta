import type { ModeThroughput } from "./profiles.ts";

/**
 * The rig facts and per-mode throughput extracted from the onstart benchmark command's raw
 * stdout (see cli.ts's `BENCHMARK_ONSTART_COMMAND`).
 */
export interface BenchmarkResult {
  readonly gpuName: string;
  readonly gpuCount: number;
  readonly gpuRamMegabytes: number;
  readonly throughput: ModeThroughput[];
}

export class BenchmarkParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchmarkParseError";
  }
}

/** Matches an `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader` line, e.g. `RTX 4090, 24564 MiB`. */
const GPU_LINE_PATTERN = /^([^,]+),\s*(\d+)\s*MiB\b/;

/** Matches the onstart command's `echo MODE=$m` marker preceding each hashcat mode's device lines. */
const MODE_LINE_PATTERN = /^MODE=(\d+)\s*$/;

interface ParsedDeviceLine {
  readonly deviceId: string;
  readonly hashesPerSecond: number;
}

/**
 * Parses one `hashcat -b --machine-readable` device line, e.g. `1:9600:2310:10251:91.27:57305`
 * (colon-delimited `deviceId:mode:_:_:execMs:speedHs`). Only the first field (the device id) and
 * the last field (the speed in H/s) are load-bearing — the fields in between vary across hashcat
 * versions and are not interpreted. Returns null for any line that does not have this shape
 * (warnings, ssh notices, blank lines), which the caller ignores.
 */
function parseDeviceLine(line: string): ParsedDeviceLine | null {
  const parts = line.split(":");
  if (parts.length < 3) return null;
  const deviceId = parts[0];
  const speedRaw = parts[parts.length - 1];
  if (deviceId === undefined || speedRaw === undefined) return null;
  if (!/^\d+$/.test(deviceId)) return null;
  // The speed field must be a non-empty run of digits: `Number("")` and `Number(" ")` are both
  // `0` and `Number.isFinite(0)` is true, so without this a truncated line like `5:9600:`
  // (trailing colon, no speed) would otherwise register a phantom device doing 0 H/s — inflating
  // gpuCount and polluting the mode's summed throughput with a fake zero.
  if (!/^\d+$/.test(speedRaw)) return null;
  return { deviceId, hashesPerSecond: Number(speedRaw) };
}

/**
 * Parses the raw stdout collected off a benchmark rig: an `nvidia-smi` CSV line for the rig
 * facts, followed by one `MODE=<n>` marker line per hashcat mode and one device line per GPU
 * under that mode. A rig with more than one GPU sums each mode's per-device speed into that
 * mode's rig-wide throughput; `gpuCount` is the number of distinct device ids seen across all
 * modes.
 *
 * Throws `BenchmarkParseError` rather than returning a partial result when no mode data (or no
 * GPU facts) is found — a silently-incomplete rig profile would corrupt downstream
 * cost-per-work rankings.
 */
export function parseBenchmarkLog(raw: string): BenchmarkResult {
  let gpuName: string | null = null;
  let gpuRamMegabytes: number | null = null;
  const deviceIds = new Set<string>();
  const modeOrder: number[] = [];
  const modeTotals = new Map<number, number>();
  let currentMode: number | null = null;

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;

    if (gpuName === null) {
      const gpuMatch = GPU_LINE_PATTERN.exec(line);
      if (gpuMatch !== null) {
        const name = gpuMatch[1];
        const ramMebibytes = gpuMatch[2];
        gpuName = (name ?? "").trim();
        gpuRamMegabytes = Number(ramMebibytes);
        continue;
      }
    }

    const modeMatch = MODE_LINE_PATTERN.exec(line);
    if (modeMatch !== null) {
      const mode = Number(modeMatch[1]);
      currentMode = mode;
      // Record the mode's position for stable output ordering, but do NOT seed a 0 total here.
      // The onstart loop echoes `MODE=$m` for every mode unconditionally, so a marker alone does
      // not mean hashcat produced a speed for it (an unsupported mode, or a driver error, prints
      // the marker with no device line). A mode is only emitted below if it actually accumulated a
      // device line — a silent 0 would read as "this rig can't do this mode" and corrupt the
      // downstream cost-per-work ranking.
      if (!modeOrder.includes(mode)) modeOrder.push(mode);
      continue;
    }

    if (currentMode === null) continue;
    const device = parseDeviceLine(line);
    if (device === null) continue;
    deviceIds.add(device.deviceId);
    modeTotals.set(currentMode, (modeTotals.get(currentMode) ?? 0) + device.hashesPerSecond);
  }

  if (modeTotals.size === 0 || gpuName === null || gpuRamMegabytes === null) {
    throw new BenchmarkParseError(
      "benchmark log has no recognizable GPU facts or MODE=/device throughput lines",
    );
  }

  // Emit only modes that produced at least one device line, in first-seen order.
  const throughput: ModeThroughput[] = modeOrder
    .filter((mode) => modeTotals.has(mode))
    .map((mode) => ({ hashcatMode: mode, hashesPerSecond: modeTotals.get(mode) ?? 0 }));

  return {
    gpuName,
    gpuCount: deviceIds.size,
    gpuRamMegabytes,
    throughput,
  };
}
