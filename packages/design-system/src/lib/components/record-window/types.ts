/*
 * The RecordWindow contract. Everything a record kind is allowed to hand the shell lives here, and
 * nothing in it names a kind of record: the window renders a heading, a subtitle, a left pane, a
 * set of tabs and an action bar, and it does not know or care what any of them contain. That is the
 * whole point of the type — a field that named one kind of record would be the first crack in the
 * one-window rule, and the source scan in tooling/lint-one-ui exists to keep it out.
 */
import type { Snippet } from "svelte";

/** One tab in the window's right pane: the context a reader goes looking for beside the record. */
export interface RecordWindowTab {
  /** Stable identity for the tab, used to select it and to name it in `defaultTab`. */
  readonly key: string;
  /** The tab's own word, as the reader sees it on the strip. */
  readonly label: string;
  /**
   * How many things the tab holds, shown beside the label. Omit it where a count would say nothing
   * — a tab whose content is one continuous thing has no count to give.
   */
  readonly count?: number;
  /** The tab's panel. It scrolls inside the tab, so length costs the window nothing. */
  readonly content: Snippet;
}
