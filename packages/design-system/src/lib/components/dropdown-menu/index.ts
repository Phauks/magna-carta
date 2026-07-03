/*
 * DropdownMenu is a composition of parts (the house namespace shape, same as Dialog/Popover): bare
 * names (Root, Trigger, Portal, Content, Item, Group, GroupHeading, Separator, CheckboxItem,
 * RadioGroup, RadioItem, Sub, SubTrigger, SubContent) plus DropdownMenu-prefixed aliases, so both
 * idioms work — `import * as DropdownMenu from ".../dropdown-menu"` then <DropdownMenu.Root>, or
 * `import { DropdownMenu, DropdownMenuItem }`. Root is also re-exported as `DropdownMenu`.
 */
import Root from "./dropdown-menu-root.svelte";
import Trigger from "./dropdown-menu-trigger.svelte";
import Portal from "./dropdown-menu-portal.svelte";
import Content from "./dropdown-menu-content.svelte";
import Item from "./dropdown-menu-item.svelte";
import Group from "./dropdown-menu-group.svelte";
import GroupHeading from "./dropdown-menu-group-heading.svelte";
import Separator from "./dropdown-menu-separator.svelte";
import CheckboxItem from "./dropdown-menu-checkbox-item.svelte";
import RadioGroup from "./dropdown-menu-radio-group.svelte";
import RadioItem from "./dropdown-menu-radio-item.svelte";
import Sub from "./dropdown-menu-sub.svelte";
import SubTrigger from "./dropdown-menu-sub-trigger.svelte";
import SubContent from "./dropdown-menu-sub-content.svelte";

export {
  Root,
  Trigger,
  Portal,
  Content,
  Item,
  Group,
  GroupHeading,
  Separator,
  CheckboxItem,
  RadioGroup,
  RadioItem,
  Sub,
  SubTrigger,
  SubContent,
  //
  Root as DropdownMenu,
  Trigger as DropdownMenuTrigger,
  Portal as DropdownMenuPortal,
  Content as DropdownMenuContent,
  Item as DropdownMenuItem,
  Group as DropdownMenuGroup,
  GroupHeading as DropdownMenuGroupHeading,
  Separator as DropdownMenuSeparator,
  CheckboxItem as DropdownMenuCheckboxItem,
  RadioGroup as DropdownMenuRadioGroup,
  RadioItem as DropdownMenuRadioItem,
  Sub as DropdownMenuSub,
  SubTrigger as DropdownMenuSubTrigger,
  SubContent as DropdownMenuSubContent,
};
