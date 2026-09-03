import type { Component } from "svelte";

/** One item of a create control that offers a menu rather than one action. */
export interface CreateChoice {
  /** What the item reads. A full phrase in title case: "New Folder", "Upload Files". */
  label: string;
  /** The Lucide glyph the item wears; every choice carries one so the menu reads as one set. */
  icon: Component;
  onselect: () => void;
  /** Present when the item cannot be pressed right now: it renders disabled carrying this line. */
  refusal?: string;
}
