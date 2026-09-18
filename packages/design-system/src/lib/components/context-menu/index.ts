/*
 * ContextMenu is a composition of parts (the house namespace shape, same as DropdownMenu): bare
 * names (Root, Trigger, Portal, Content, Item, Group, GroupHeading, Separator, CheckboxItem,
 * RadioGroup, RadioItem, Sub, SubTrigger, SubContent) plus ContextMenu-prefixed aliases, so both
 * idioms work — `import * as ContextMenu from ".../context-menu"` then <ContextMenu.Root>, or
 * `import { ContextMenu, ContextMenuItem }`. Root is also re-exported as `ContextMenu`.
 *
 * The right-click sibling of DropdownMenu: same Bits UI Menu behaviour and a11y, same recipe look,
 * but summoned by a contextmenu event over the Trigger region rather than by a button — the file
 * manager's row/card actions.
 */
import Root from "./context-menu-root.svelte";
import Trigger from "./context-menu-trigger.svelte";
import Portal from "./context-menu-portal.svelte";
import Content from "./context-menu-content.svelte";
import Item from "./context-menu-item.svelte";
import Group from "./context-menu-group.svelte";
import GroupHeading from "./context-menu-group-heading.svelte";
import Separator from "./context-menu-separator.svelte";
import CheckboxItem from "./context-menu-checkbox-item.svelte";
import RadioGroup from "./context-menu-radio-group.svelte";
import RadioItem from "./context-menu-radio-item.svelte";
import Sub from "./context-menu-sub.svelte";
import SubTrigger from "./context-menu-sub-trigger.svelte";
import SubContent from "./context-menu-sub-content.svelte";

export { keepMenuFieldKeys } from "./menu-field-keys.ts";
export { keepMenuFieldLayer } from "./menu-field-layer.ts";

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
  Root as ContextMenu,
  Trigger as ContextMenuTrigger,
  Portal as ContextMenuPortal,
  Content as ContextMenuContent,
  Item as ContextMenuItem,
  Group as ContextMenuGroup,
  GroupHeading as ContextMenuGroupHeading,
  Separator as ContextMenuSeparator,
  CheckboxItem as ContextMenuCheckboxItem,
  RadioGroup as ContextMenuRadioGroup,
  RadioItem as ContextMenuRadioItem,
  Sub as ContextMenuSub,
  SubTrigger as ContextMenuSubTrigger,
  SubContent as ContextMenuSubContent,
};
