// Generation can NEVER run in production (white paper _Synthetic data & fixtures_). Two layers:
// the explicit opt-in below, and the boundary rule that production worker code never imports this
// package (ADR-0070). NODE_ENV is checked when present (Node contexts); Workers have no process.
export interface SeedingOptions {
  readonly allowSeeding: boolean;
}

export function assertSeedingAllowed(options: SeedingOptions): void {
  if (options.allowSeeding !== true) {
    throw new Error("fixtures: seeding requires the explicit { allowSeeding: true } opt-in");
  }
  const nodeEnv = (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[
    "NODE_ENV"
  ];
  if (nodeEnv === "production") {
    throw new Error("fixtures: seeding is forbidden in production");
  }
}
