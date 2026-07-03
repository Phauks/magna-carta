/*
 * RadioGroup is a composition of parts (the house namespace shape): bare names (Root, Item) plus
 * RadioGroup-prefixed aliases, so both `import * as RadioGroup` and `import { RadioGroup,
 * RadioGroupItem }` work.
 */
import Root from "./radio-group.svelte";
import Item from "./radio-group-item.svelte";

export {
  Root,
  Item,
  //
  Root as RadioGroup,
  Item as RadioGroupItem,
};
