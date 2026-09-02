/*
 * The firm's container tree, flattened into the choices a form can offer.
 *
 * WHY A PATH AND NOT A NAME. Firms name containers by their position in something bigger: "Box 4",
 * "Shelf 2", "Drawer A". Offered as bare names in a list, a dozen of those are indistinguishable,
 * and choosing the wrong one files an original will in the wrong building. So every choice carries
 * the walk down to it, which is also the form a person says out loud when telling somebody where to
 * go and look.
 *
 * WHY CLOSED NODES ARE NOT OFFERED. A location is closed rather than deleted, precisely so the
 * history of everything that was ever kept in it stays readable. Offering one as somewhere to put
 * property now would reopen it by the back door, and the server refuses it anyway.
 *
 * Pure, and separate from the tree component, because the ORDER is the interesting part: parents
 * before children, so an indented list reads as the tree it came from rather than as the arbitrary
 * order a table happened to answer in.
 */
import type { CustodyLocationNode } from "./custody-api.ts";

/** One node as a form offers it. */
export interface CustodyLocationOption {
  id: string;
  /** The walk from the root down to this node, as a reader would say it. */
  path: string;
  /** How deep it sits, so a list can indent instead of repeating the whole path visually. */
  depth: number;
}

/** The separator between the steps of a container path. */
const STEP = " › ";

/**
 * Every active node, parents before children, each carrying its full path.
 *
 * A node whose parent is missing from the tree is walked as its own root rather than dropped: a
 * container a reader cannot see is a container they will not put anything in, and losing a whole
 * branch because one row above it was closed would hide most of a firm's storage.
 */
export function custodyLocationOptions(
  nodes: readonly CustodyLocationNode[],
): readonly CustodyLocationOption[] {
  const active = nodes.filter((node) => node.status === "active");
  const byParent = new Map<string | null, CustodyLocationNode[]>();
  const present = new Set(active.map((node) => node.id));
  for (const node of active) {
    // A parent that is not itself offered cannot hold this node in the walk, so the node roots
    // its own branch rather than disappearing under a key nothing visits.
    const parent =
      node.parentLocationId !== null && present.has(node.parentLocationId)
        ? node.parentLocationId
        : null;
    const siblings = byParent.get(parent);
    if (siblings === undefined) byParent.set(parent, [node]);
    else siblings.push(node);
  }

  const options: CustodyLocationOption[] = [];
  const walk = (parent: string | null, prefix: string, depth: number): void => {
    const children = byParent.get(parent) ?? [];
    for (const child of children.toSorted((left, right) => left.name.localeCompare(right.name))) {
      const path = prefix === "" ? child.name : `${prefix}${STEP}${child.name}`;
      options.push({ id: child.id, path, depth });
      walk(child.id, path, depth + 1);
    }
  };
  walk(null, "", 0);
  return options;
}

/** One node's path, or null where the tree does not name it. */
export function custodyLocationPath(
  nodes: readonly CustodyLocationNode[],
  locationId: string | null,
): string | null {
  if (locationId === null) return null;
  return custodyLocationOptions(nodes).find((option) => option.id === locationId)?.path ?? null;
}
