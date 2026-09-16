/*
 * Resolving a drizzle migration journal — the rules half, with no filesystem and no git in it.
 *
 * THE CONFLICT THIS EXISTS FOR. Two branches each add a migration. `_journal.json` conflicts,
 * because both appended an entry to the same array at the same place. The conflict LOOKS trivial —
 * two adjacent objects, keep both — and resolving it that way is wrong in two ways at once that a
 * diff cannot show:
 *
 *   * `idx` is drizzle's dense counter and names the `meta/NNNN_snapshot.json` files, so a naive
 *     union leaves two entries sharing an idx, and the next `drizzle-kit generate` diffs against
 *     whichever snapshot that resolves to.
 *   * the branch's migration keeps the timestamp it was written under, which is now BELOW the
 *     migration that landed on main while the branch was open. Apply order is by tag, so a fresh
 *     database then runs the branch's migration before the one it was written on top of, building
 *     its schema in an order no already-migrated firm ever used.
 *
 * The second one is the dangerous one, because nothing about the merge looks wrong afterwards and
 * every firm that already exists keeps working. Two of those reached `main` in September 2026.
 *
 * WHAT DECIDES THE ANSWER. Not "ours" and "theirs" — which of those is the branch depends on which
 * direction the merge ran, and getting it backwards re-stamps the wrong migration. It is `main`:
 * `main` is production here, so a tag that is on `main` has deployed and is immutable, and a tag
 * that is not can still be moved for free. So the trunk's entries keep their tags and their order,
 * and everything else is appended after them and re-stamped above the head.
 *
 * That framing also makes this the REPAIR tool, not only the merge tool: a lineage that is already
 * inverted on a branch resolves the same way, from the single journal on disk.
 */

import { nextTagAbove, slugOf } from "./stamp.mjs";

/**
 * The resolved journal for one lineage.
 *
 * @param {object} input
 * @param {readonly {idx: number, tag: string}[]} input.trunk entries as `main` has them. Their tags
 *   are immutable and their relative order is kept.
 * @param {readonly (readonly {idx: number, tag: string}[])[]} input.sides the entries of every side
 *   being resolved: the two conflict stages during a merge, or the one journal on disk when
 *   repairing. Entries are deduplicated by tag across the sides.
 * @param {Date} [input.now] the wall clock, injectable so tests are not timing-dependent.
 * @returns {{ entries: object[], renames: { from: string, to: string }[] }} the entries with dense
 *   `idx` in apply order, and every migration that had to be re-stamped to get there.
 */
export function resolveJournal({ trunk, sides, now = new Date() }) {
  const trunkOrder = new Map(
    [...trunk]
      .sort((left, right) => left.idx - right.idx)
      .map((entry, position) => [entry.tag, position]),
  );

  // Deduplicate by tag, keeping the first side's copy of an entry and the LOWEST idx any side gave
  // it — that idx is the migration's integration order, which is the order the locals have to stay
  // in below. The same tag on two sides is the normal case: everything before the branch point.
  const seen = new Map();
  for (const side of sides) {
    for (const entry of side) {
      const already = seen.get(entry.tag);
      if (already === undefined) {
        seen.set(entry.tag, { ...entry });
        continue;
      }
      if (entry.idx < already.idx) already.idx = entry.idx;
    }
  }

  const missingFromSides = [...trunkOrder.keys()].filter((tag) => !seen.has(tag));
  if (missingFromSides.length > 0) {
    // A tag on `main` has deployed. Dropping it here would produce a journal that silently disagrees
    // with every database in the fleet, which is not a resolution this tool is allowed to reach.
    throw new Error(
      `these migrations are on main but in none of the journals being resolved: ${missingFromSides.join(", ")}. ` +
        "A deployed migration cannot be removed — restore it before resolving.",
    );
  }

  const onTrunk = [...seen.values()]
    .filter((entry) => trunkOrder.has(entry.tag))
    .sort((left, right) => trunkOrder.get(left.tag) - trunkOrder.get(right.tag));

  // Everything not on main, in the order it was integrated. A later migration may depend on an
  // earlier one, so integration order is what has to be preserved; the tags are then made to agree
  // with it rather than the other way round.
  const local = [...seen.values()]
    .filter((entry) => !trunkOrder.has(entry.tag))
    .sort((left, right) =>
      left.idx !== right.idx ? left.idx - right.idx : left.tag < right.tag ? -1 : 1,
    );

  let head = onTrunk.reduce((highest, entry) => (entry.tag > highest ? entry.tag : highest), "");
  const renames = [];
  for (const entry of local) {
    if (entry.tag <= head) {
      const to = nextTagAbove(head, slugOf(entry.tag), now);
      renames.push({ from: entry.tag, to });
      entry.tag = to;
    }
    head = entry.tag;
  }

  const entries = [...onTrunk, ...local].map((entry, position) => ({ ...entry, idx: position }));
  return { entries, renames };
}

/** Whether a journal's entries apply in the order they were integrated in — the property above. */
export function applyOrderIsIntegrationOrder(entries) {
  const byIdx = [...entries].sort((left, right) => left.idx - right.idx);
  return byIdx.every((entry, position) => position === 0 || entry.tag > byIdx[position - 1].tag);
}
