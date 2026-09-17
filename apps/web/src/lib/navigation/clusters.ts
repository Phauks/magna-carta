/*
 * SUB-MENU CLUSTERS — the rail's second level.
 *
 * A group whose rows outgrow a glance needs a fold inside it, not a longer list. A cluster is that
 * fold: one row bearing a glyph, a name and a chevron, with its members tucked beneath it. It is
 * NOT a screen. Nothing is reached through a cluster, it has no address, and pressing it opens the
 * rows rather than navigating — which is the whole difference between this and the /tools index it
 * replaced (that index was a screen you had to pass through to reach a tool, and it cost every tool
 * the width of a navigation column).
 *
 * WHERE THE CLUSTERS COME FROM. The tool clusters are the catalog's own subject groups
 * (@magna-carta/tools types.ts) — one home for what a tool is about, rendered here. The mechanism
 * is general, though: any destination in any group may name a cluster, so a group that grows past
 * a glance folds the same way the Tools group does, with no new machinery.
 *
 * A CLUSTER OF ONE IS NOT A CLUSTER. The render tree (sidebar-preferences.svelte.ts) seats a
 * single-member cluster as a plain row in its group, because a chevron hiding one row costs a press
 * and saves nothing. It becomes a fold by itself the day a second member joins — which is also why
 * a cluster is declared for every subject rather than only the crowded ones.
 *
 * THE COLLAPSED ICON RAIL DOES NOT FOLD, for the same reason it does not fold groups: a rail with
 * no visible labels has nothing to fold BY, so every row shows as an icon and the folds are waiting
 * when the rail opens again.
 */
import type { Component } from "svelte";
import Library from "@lucide/svelte/icons/library";
import Network from "@lucide/svelte/icons/network";
import Mail from "@lucide/svelte/icons/mail";
import Files from "@lucide/svelte/icons/files";
import type { DestinationGroup } from "./destinations.ts";

export interface NavigationCluster {
  /** Stable id — what a destination names in its `cluster` field. */
  readonly id: string;
  /** The group this cluster folds rows inside. */
  readonly group: DestinationGroup;
  /** The cluster's name, in the rail's row voice (sentence case, the words a member would use). */
  readonly label: string;
  /** The cluster's glyph, distinct from every member's so the fold reads as a category. */
  readonly icon: Component;
}

/**
 * Every cluster, in the order its group renders them. A cluster is seated at the position of its
 * FIRST member within the group, so this order governs only clusters against each other.
 *
 * The four tool clusters answer the question the old eight subject groups could not: what is this
 * tool FOR. "Records" is a public register opened for somebody the firm is working on, "Internet"
 * is the network and what is on it, "Mailing" is what the firm sends, "Files" is a file that
 * belongs to no matter. A member reaching for a WHOIS record thinks "internet", never "web-domains".
 */
export const NAVIGATION_CLUSTERS: readonly NavigationCluster[] = [
  { id: "records", group: "tools", label: "Records", icon: Library },
  { id: "internet", group: "tools", label: "Internet", icon: Network },
  { id: "mailing", group: "tools", label: "Mailing", icon: Mail },
  { id: "files", group: "tools", label: "Files", icon: Files },
];

/** One cluster by id, or null — null means the rows naming it render as plain rows in their group. */
export function clusterById(id: string): NavigationCluster | null {
  return NAVIGATION_CLUSTERS.find((cluster) => cluster.id === id) ?? null;
}
