/*
 * Combobox is a composition of parts. Root, Input, and Content are Combobox-specific; the option
 * parts (Item, Group, GroupHeading) are REUSED from Select — bits implements Combobox's listbox with
 * the very same components (golden rule 1), so the Select wrappers serve both. Bare names plus
 * Combobox-prefixed aliases, so both idioms work — `import * as Combobox from ".../combobox"` then
 * <Combobox.Root>, or `import { Combobox, ComboboxItem }`. Root is also re-exported as `Combobox`.
 */
import Root from "./combobox-root.svelte";
import Input from "./combobox-input.svelte";
import Content from "./combobox-content.svelte";
import Item from "../select/select-item.svelte";
import Group from "../select/select-group.svelte";
import GroupHeading from "../select/select-group-heading.svelte";

export {
  Root,
  Input,
  Content,
  Item,
  Group,
  GroupHeading,
  //
  Root as Combobox,
  Input as ComboboxInput,
  Content as ComboboxContent,
  Item as ComboboxItem,
  Group as ComboboxGroup,
  GroupHeading as ComboboxGroupHeading,
};
