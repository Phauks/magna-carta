/*
 * Select is a composition of parts (the house namespace shape, same as Dialog/Popover/DropdownMenu):
 * bare names (Root, Trigger, Value, Content, Item, Group, GroupHeading, ScrollUpButton,
 * ScrollDownButton) plus Select-prefixed aliases, so both idioms work —
 * `import * as Select from ".../select"` then <Select.Root>, or
 * `import { Select, SelectItem }`. Root is also re-exported as `Select`.
 *
 * The Viewport and Portal are composed inside Content (the caller never wires them), so they are not
 * exported parts; the scroll buttons are also baked into Content but exported for advanced layouts.
 */
import Root from "./select-root.svelte";
import Trigger from "./select-trigger.svelte";
import Value from "./select-value.svelte";
import Content from "./select-content.svelte";
import Item from "./select-item.svelte";
import Group from "./select-group.svelte";
import GroupHeading from "./select-group-heading.svelte";
import ScrollUpButton from "./select-scroll-up-button.svelte";
import ScrollDownButton from "./select-scroll-down-button.svelte";

export {
  Root,
  Trigger,
  Value,
  Content,
  Item,
  Group,
  GroupHeading,
  ScrollUpButton,
  ScrollDownButton,
  //
  Root as Select,
  Trigger as SelectTrigger,
  Value as SelectValue,
  Content as SelectContent,
  Item as SelectItem,
  Group as SelectGroup,
  GroupHeading as SelectGroupHeading,
  ScrollUpButton as SelectScrollUpButton,
  ScrollDownButton as SelectScrollDownButton,
};
