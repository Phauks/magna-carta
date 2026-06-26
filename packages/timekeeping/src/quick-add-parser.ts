// The one-line capture grammar: "<duration> [<matter hint> —|-] <narrative>". The parser is pure and
// total over its three fields — it reads the duration and (optionally) a matter HINT string, but never
// resolves that hint to a stored matter: ambiguity is the caller's to surface for confirmation, so a
// one-line capture can never silently bill the wrong matter. No competitor ships a built-in parser; the
// grammar is deliberately small and explicit rather than a free-text NLP guess.

export interface QuickAddParse {
  readonly durationMinutes: number;
  readonly matterHint: string | null;
  readonly narrative: string;
}

// Leading duration token: decimal hours ("0.5", "2"), "1h30m" / "1h" / "30m", anchored at the start.
const DURATION_PATTERN = /^\s*(?:(\d+)h(?:(\d+)m)?|(\d+)m|(\d+(?:\.\d+)?))\b/;

// Either an em dash or a hyphen separates the optional hint from the narrative. Leading whitespace
// before the separator is optional — when no hint is present the remainder starts directly with the
// separator character (e.g. "— research"). Trailing whitespace is required to avoid matching a
// literal hyphen inside a matter name like "Smith-v-Jones" that isn't followed by a space.
const SEPARATOR_PATTERN = /\s*[—-]\s+/;

function durationToMinutes(match: RegExpExecArray): number {
  const [, hoursOfHM, minutesOfHM, bareMinutes, decimalHours] = match;
  if (hoursOfHM !== undefined) {
    return Number(hoursOfHM) * 60 + (minutesOfHM !== undefined ? Number(minutesOfHM) : 0);
  }
  if (bareMinutes !== undefined) return Number(bareMinutes);
  // decimalHours is integer minutes only when hours map cleanly; round to whole minutes (the captured
  // raw quantity), leaving the billing-increment rounding to roundDuration at the write boundary.
  return Math.round(Number(decimalHours) * 60);
}

export function parseQuickAdd(text: string): QuickAddParse {
  const durationMatch = DURATION_PATTERN.exec(text);
  if (durationMatch === null) {
    throw new Error("quick-add text must begin with a duration (e.g. 0.5, 45m, 1h30m)");
  }
  const durationMinutes = durationToMinutes(durationMatch);
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new Error("quick-add duration must be a positive number of minutes");
  }

  const remainder = text.slice(durationMatch[0].length).trim();
  const separator = SEPARATOR_PATTERN.exec(remainder);
  if (separator === null || separator.index === undefined) {
    // No "hint — narrative" split: the whole remainder is the narrative; no matter is named.
    return { durationMinutes, matterHint: null, narrative: remainder };
  }
  const hint = remainder.slice(0, separator.index).trim();
  const narrative = remainder.slice(separator.index + separator[0].length).trim();
  return { durationMinutes, matterHint: hint.length > 0 ? hint : null, narrative };
}
