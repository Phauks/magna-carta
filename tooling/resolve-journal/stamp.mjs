/*
 * How a migration tag is computed — the one implementation, because two of them is the bug.
 *
 * A migration id is `YYYYMMDDThhmmss_slug` in UTC, and the lexical order of those tags IS the order
 * every database applies the lineage in (packages/database/src/migration.ts). So "give this
 * migration a tag" always means "give it one that sorts above everything already in the lineage",
 * and getting that subtly wrong in one of two copies is how a lineage ends up inverted.
 *
 * Both callers are here: `packages/database/scripts/timestamp-latest-migration.mjs`, which stamps
 * the migration drizzle-kit just wrote or re-stamps one a merge left below the head, and
 * `tooling/resolve-journal`, which re-stamps every migration a merge brought in.
 */

/** A stamped migration id. The 15 leading characters are the stamp; the rest is the slug. */
export const TAG_PATTERN = /^\d{8}T\d{6}_/u;

/** The slug half of a tag — what the migration is called, with the stamp taken off. */
export function slugOf(tag) {
  return tag.replace(TAG_PATTERN, "");
}

/** A Date as `YYYYMMDDThhmmss`, UTC. */
export function stampOf(when) {
  return when
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d+Z$/u, "");
}

/** The instant a stamp names, as a Date. */
function instantOf(stamp) {
  return new Date(
    `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T` +
      `${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`,
  );
}

/**
 * A tag for `slug` that sorts strictly above `head`.
 *
 * Normally that is just the wall clock, which is what makes the id readable — it says when the
 * migration was written. But the clock is not guaranteed to be above the head: a head stamped on a
 * machine running ahead, two re-stamps inside the same second, or a whole merge's worth of
 * migrations re-stamped in one pass all land at or below it. Stepping one second past the head is
 * the only thing that has to be true, so that is the fallback rather than the rule.
 *
 * @param {string} head the greatest tag already in the lineage; `""` for an empty lineage.
 * @param {string} slug the migration's name, without a stamp.
 * @param {Date} [now] the wall clock, injectable so the tests are not timing-dependent.
 */
export function nextTagAbove(head, slug, now = new Date()) {
  const fromClock = `${stampOf(now)}_${slug}`;
  if (fromClock > head) return fromClock;
  const stepped = instantOf(head.slice(0, 15));
  stepped.setUTCSeconds(stepped.getUTCSeconds() + 1);
  return `${stampOf(stepped)}_${slug}`;
}
