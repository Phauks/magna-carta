/*
 * ItemDrag — the product's one gesture for dragging its own items from one place to another, and
 * the one question that tells that gesture apart from a file dropped in from the desktop.
 */
export {
  ITEM_DRAG_KEY_ATTRIBUTE,
  ITEM_DRAG_MEDIA_TYPE,
  ITEM_DROP_KEY_ATTRIBUTE,
  ITEM_DROP_MARK_ATTRIBUTE,
  carriesDraggedItems,
  carriesExternalFiles,
  decodeDraggedItems,
  encodeDraggedItems,
} from "./item-drag.ts";
export { ItemDrag, createItemDrag, itemDragAnchorBy } from "./item-drag.svelte.ts";
export type {
  ItemDragAnchor,
  ItemDragHandlers,
  ItemDragOptions,
  ItemDragRegion,
} from "./item-drag.svelte.ts";
