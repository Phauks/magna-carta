import { cryptoRandomSource, type RandomSource } from "@magna-carta/identifiers/random";

/*
 * A MEETING'S ADDRESS IS NINE DIGITS, AND A PERSONAL ROOM'S IS A NAME.
 *
 * The digits are the meeting's join code too: /meeting/482-917-305 is the address, and 482-917-305
 * is what somebody reads aloud on a call or types into a box. Stored as nine bare digits, shown in
 * three groups.
 *
 * A personal room's address is its owner's first name in lower case (/room/trevor), then the first
 * and last names joined, then a number, until one is free. A room given a name of its own ("Red
 * Room") is addressed by that name instead (/room/red-room), and renaming a room moves its address
 * with it: the old address stops working, which is the owner's ruling (no legacy addresses).
 */

export const MEETING_JOIN_CODE_LENGTH = 9;

/** A fresh code, uniformly drawn: nine digits, the first never a zero so it reads as a number. */
export function newMeetingJoinCode(randomSource: RandomSource = cryptoRandomSource): string {
  let code = "";
  while (code.length < MEETING_JOIN_CODE_LENGTH) {
    for (const byte of randomSource(MEETING_JOIN_CODE_LENGTH)) {
      // 250 is the largest multiple of ten under 256, so every digit is equally likely.
      if (byte >= 250) continue;
      const digit = byte % 10;
      if (code.length === 0 && digit === 0) continue;
      code += String(digit);
      if (code.length === MEETING_JOIN_CODE_LENGTH) break;
    }
  }
  return code;
}

/** The code as it is shown and spoken: 482-917-305. */
export function formatMeetingJoinCode(code: string): string {
  return code.length === MEETING_JOIN_CODE_LENGTH
    ? `${code.slice(0, 3)}-${code.slice(3, 6)}-${code.slice(6)}`
    : code;
}

/**
 * The nine digits somebody typed or pasted, with the spaces and dashes they put between them taken
 * out; undefined when what is left is not nine digits.
 */
export function parseMeetingJoinCode(typed: string): string | undefined {
  const digits = typed.replaceAll(/[\s-]/g, "");
  return /^\d{9}$/.test(digits) ? digits : undefined;
}

/** The longest address name a room may have, as the database holds it. */
export const ROOM_ADDRESS_NAME_MAXIMUM = 40;

function plainWord(word: string): string | undefined {
  const lower = word.toLowerCase();
  return lower.length > 0 && lower.length <= 30 && /^[a-z0-9]+$/.test(lower) ? lower : undefined;
}

/**
 * The names a room's address is tried as, in order: the first name, then the first and last names
 * joined. Empty where the name has no plain word to begin with (an accent, a hyphen), and the caller
 * then numbers the room's link code instead.
 */
export function roomAddressNames(displayName: string): readonly string[] {
  const words = displayName.trim().split(/\s+/);
  const first = plainWord(words[0] ?? "");
  if (first === undefined) return [];
  const last = words.length > 1 ? plainWord(words.at(-1) ?? "") : undefined;
  return last === undefined ? [first] : [first, `${first}-${last}`];
}

/**
 * The address a room's own name is tried as: its words in lower case joined by hyphens, with
 * anything but plain letters and digits dropped (an accented letter is dropped, not guessed at).
 * Empty where nothing is left, and the caller falls back as it does for a member's name.
 */
export function roomAddressFromTitle(title: string): readonly string[] {
  const slug = title
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replaceAll(/[^a-z0-9]/g, ""))
    .filter((word) => word.length > 0)
    .join("-")
    .slice(0, ROOM_ADDRESS_NAME_MAXIMUM - 4)
    .replace(/-+$/, "");
  return slug === "" ? [] : [slug];
}

/**
 * The first free address for a room, given the names already taken. Each candidate is tried as it
 * is, then the last one with -2, -3 and onward.
 */
export function freeRoomAddressName(
  candidates: readonly string[],
  taken: ReadonlySet<string>,
): string {
  for (const candidate of candidates) if (!taken.has(candidate)) return candidate;
  const base = candidates.at(-1) ?? "room";
  for (let number = 2; ; number += 1) {
    const numbered = `${base}-${String(number)}`;
    if (!taken.has(numbered)) return numbered;
  }
}
