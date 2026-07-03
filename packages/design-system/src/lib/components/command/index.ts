/*
 * Command is a composition of parts (the house namespace shape, same as the other multi-part
 * components): bare names (Root, Input, List, Empty, Group, GroupHeading, GroupItems, Item,
 * Separator) plus Command-prefixed aliases, so both idioms work —
 * `import * as Command from ".../command"` then <Command.Root>, or `import { Command, CommandItem }`.
 * Root is also re-exported as `Command`.
 */
import Root from "./command-root.svelte";
import Input from "./command-input.svelte";
import List from "./command-list.svelte";
import Viewport from "./command-viewport.svelte";
import Empty from "./command-empty.svelte";
import Group from "./command-group.svelte";
import GroupHeading from "./command-group-heading.svelte";
import GroupItems from "./command-group-items.svelte";
import Item from "./command-item.svelte";
import Separator from "./command-separator.svelte";

export {
  Root,
  Input,
  List,
  Viewport,
  Empty,
  Group,
  GroupHeading,
  GroupItems,
  Item,
  Separator,
  //
  Root as Command,
  Input as CommandInput,
  List as CommandList,
  Viewport as CommandViewport,
  Empty as CommandEmpty,
  Group as CommandGroup,
  GroupHeading as CommandGroupHeading,
  GroupItems as CommandGroupItems,
  Item as CommandItem,
  Separator as CommandSeparator,
};
