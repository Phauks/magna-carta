/*
 * SegmentedControl is a composition of parts (the house namespace shape): bare names (Root, Item)
 * plus SegmentedControl-prefixed aliases.
 */
import Root from "./segmented-control.svelte";
import Item from "./segmented-control-item.svelte";

export {
  Root,
  Item,
  //
  Root as SegmentedControl,
  Item as SegmentedControlItem,
};
