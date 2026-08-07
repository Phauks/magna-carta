import { NEVADA_PROFILE } from "./data/nevada.ts";
import type { JurisdictionProfile } from "./types.ts";

// Every jurisdiction whose trust rules this platform has encoded. ONE. Nevada is the firm's own
// state and the only jurisdiction whose rules have been read against the state's published text.
//
// Adding a jurisdiction is adding a module here, and it costs the same primary-source work Nevada
// cost: the rule text, the verbatim quotes, the searches that establish what a jurisdiction does NOT
// require, and an attorney's review. There is deliberately no baseline profile, no "most states do
// X" fallback, and no way to reach a value for a jurisdiction that is not in this map — a firm shown
// a confident wrong answer will act on it, and a firm told the platform has not encoded its state
// will check.
const PROFILES: ReadonlyMap<string, JurisdictionProfile> = new Map([
  [NEVADA_PROFILE.jurisdictionCode, NEVADA_PROFILE],
]);

export function findJurisdictionProfile(jurisdictionCode: string): JurisdictionProfile | null {
  return PROFILES.get(jurisdictionCode.trim().toUpperCase()) ?? null;
}

// Declaration order, which is alphabetical by construction because the map above is written that
// way. Kept as insertion order rather than sorted on read so the answer is stable and cheap.
export function encodedJurisdictionCodes(): readonly string[] {
  return [...PROFILES.keys()];
}
