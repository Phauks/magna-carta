/**
 * The measured throughput of a rig for one hashcat attack mode.
 */
export interface ModeThroughput {
  readonly hashcatMode: number;
  readonly hashesPerSecond: number;
}

/**
 * A committed benchmark measurement for one GPU rig configuration: the price to rent it, how long
 * it takes to boot before it starts producing candidates, and its measured throughput per hashcat
 * mode.
 */
export interface RigProfile {
  readonly gpuName: string;
  readonly gpuCount: number;
  readonly gpuRamMegabytes: number;
  readonly dollarsPerHour: number;
  readonly bootSeconds: number;
  readonly throughput: ReadonlyArray<ModeThroughput>;
  readonly measuredAt: string;
}

/**
 * The value metric this module ranks rigs by: dollars to search one billion candidates in the
 * given hashcat mode, derived from measured throughput divided by rental price. This is a
 * cost-per-work figure computed from our own measurements — not a marketplace-reported compute
 * score, which conflates unrelated workloads and does not reflect this mode's actual throughput.
 * Returns null when the rig has no measurement for the requested mode.
 */
export function dollarsPerBillionCandidates(profile: RigProfile, hashcatMode: number): number | null {
  const mode = profile.throughput.find((entry) => entry.hashcatMode === hashcatMode);
  if (mode === undefined || mode.hashesPerSecond <= 0) return null;
  const secondsForOneBillion = 1e9 / mode.hashesPerSecond;
  const hoursForOneBillion = secondsForOneBillion / 3600;
  return hoursForOneBillion * profile.dollarsPerHour;
}

/**
 * Ranks rigs cheapest-per-work first for the given hashcat mode. Rigs with no measurement for the
 * mode sort last (in their original relative order), since they cannot be compared on value.
 */
export function rankByValue(profiles: RigProfile[], hashcatMode: number): RigProfile[] {
  const withValue = profiles.map((profile) => ({
    profile,
    value: dollarsPerBillionCandidates(profile, hashcatMode),
  }));
  withValue.sort((a, b) => {
    if (a.value === null && b.value === null) return 0;
    if (a.value === null) return 1;
    if (b.value === null) return -1;
    return a.value - b.value;
  });
  return withValue.map((entry) => entry.profile);
}

/**
 * Replaces the existing entry matching (gpuName, gpuCount) with `next`, or appends `next` if no
 * entry matches. Pure — returns a new array, leaves `table` untouched.
 */
export function upsertProfile(table: RigProfile[], next: RigProfile): RigProfile[] {
  const index = table.findIndex(
    (entry) => entry.gpuName === next.gpuName && entry.gpuCount === next.gpuCount,
  );
  if (index === -1) return [...table, next];
  const updated = [...table];
  updated[index] = next;
  return updated;
}
