// A release channel is a firm-level attribute that decides which behavior is lit. Channels nest
// alpha (broadest) over beta over stable: an alpha firm also sees beta behavior. The value lives in
// the control-plane firm row; this type is the single shared definition every layer imports.
export type ReleaseChannel = "stable" | "beta" | "alpha";

export const RELEASE_CHANNELS: readonly ReleaseChannel[] = ["stable", "beta", "alpha"];

export function isReleaseChannel(value: string): value is ReleaseChannel {
  return (RELEASE_CHANNELS as readonly string[]).includes(value);
}

// The attributes a flag rule may target on. targetingKey is the stable per-user identity Flagship
// hashes for consistent percentage bucketing; firmId and channel drive the channel-targeting rules.
// Only non-privileged identifiers travel here — never firm content.
export interface FlagContext {
  readonly targetingKey: string;
  readonly firmId: string;
  readonly channel: ReleaseChannel;
}

// Every evaluation supplies a default; an unreachable provider or missing flag yields the default.
// Defaults always equal stable behavior, so a flag outage degrades to stable, never to exposure.
export interface FlagEvaluator {
  getBoolean(flagKey: string, defaultValue: boolean, context: FlagContext): Promise<boolean>;
}
