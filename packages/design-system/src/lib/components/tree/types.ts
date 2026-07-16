/**
 * One node in a Tree. A node with a non-empty `children` array is a parent (it gets a twisty and an
 * `aria-expanded` state); a node without children is a leaf.
 *
 * Colocated in a plain module (not the .svelte) so the type can be re-exported and imported by plain
 * tsc; a `type` re-exported from a `*.svelte` file resolves only under svelte-check.
 */
export type TreeNode = {
  /** Stable identity — the selection value, the expansion key, and the focus target. */
  id: string;
  /** The visible label; also the treeitem's accessible name and the typeahead key. */
  label: string;
  /** Child nodes. A non-empty array makes this an expandable parent. */
  children?: TreeNode[];
};
