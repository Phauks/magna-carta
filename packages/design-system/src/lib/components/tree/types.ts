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

/**
 * What a row knows about itself when the consumer draws part of it. Handed to the `icon` and
 * `trailing` snippets so a caller can vary a glyph by depth or expansion without re-deriving any of
 * it, and so the tree keeps ONE walk over the data rather than the caller keeping a second one.
 */
export type TreeItemContext = {
  /** The node this row renders. */
  node: TreeNode;
  /** Depth, starting at 1 for a root node — the same number that reaches `aria-level`. */
  level: number;
  /** Whether the node has children, and therefore a working twisty. */
  hasChildren: boolean;
  /** Whether the node is currently expanded. Always false for a leaf. */
  expanded: boolean;
  /** Whether the node is the selected one. */
  selected: boolean;
};
