// Why an end-to-end encrypted meeting's group says encryption is paused. The flag is written into the
// MLS group context by a host's commit (crates/mls-core), so every browser reads it from group state it
// verified itself. This module is the bit table alone and needs no WebAssembly: the meeting screen
// imports it to name a pause without loading the engine.

/**
 * Why the group says encryption is paused, as bits: the server can hear the meeting while any of these
 * runs. Zero is encrypted.
 */
export const PAUSE_REASONS = { recording: 0b001, captions: 0b010, phone: 0b100 } as const;
export type PauseReason = keyof typeof PAUSE_REASONS;

/** The reasons a set of pause bits names, in a fixed order. */
export function pauseReasons(bits: number): readonly PauseReason[] {
  return (Object.keys(PAUSE_REASONS) as PauseReason[]).filter(
    (reason) => (bits & PAUSE_REASONS[reason]) !== 0,
  );
}

/** The bits for a set of pause reasons. */
export function pauseBits(reasons: Iterable<PauseReason>): number {
  let bits = 0;
  for (const reason of reasons) bits |= PAUSE_REASONS[reason];
  return bits;
}
