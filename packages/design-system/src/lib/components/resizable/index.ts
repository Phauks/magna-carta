/*
 * Resizable — split panes on paneforge (PaneGroup/Pane/PaneResizer), styled with mc-resizable-*
 * recipes. The house namespace shape: bare names (PaneGroup/Pane/Handle) plus Resizable-prefixed
 * aliases, so both `import * as Resizable` and `{ ResizablePaneGroup, ResizableHandle }` work.
 * Behaviour (drag, keyboard resize, persisted layout, separator a11y) is paneforge's; the visible
 * chrome is ours. Used for per-view split layouts (a folder tree, a list + detail rail) — not the
 * fixed app-shell sidebar, which is the Sidebar component.
 */
import PaneGroup from "./resizable-pane-group.svelte";
import Pane from "./resizable-pane.svelte";
import Handle from "./resizable-handle.svelte";

export {
  PaneGroup,
  Pane,
  Handle,
  //
  PaneGroup as ResizablePaneGroup,
  Pane as ResizablePane,
  Handle as ResizableHandle,
};
