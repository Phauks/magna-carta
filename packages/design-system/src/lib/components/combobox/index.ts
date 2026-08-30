/*
 * Combobox is a composition of parts, and it is the product's ONE dropdown: every place a person
 * chooses from a set, they can type to narrow it. Root, Input, Content and AddOption are
 * Combobox-specific; the option parts (Item, Group, GroupHeading) are REUSED from Select — bits
 * implements Combobox's listbox with the very same components (golden rule 1), so the Select wrappers
 * serve both. Bare names plus Combobox-prefixed aliases, so both idioms work —
 * `import * as Combobox from ".../combobox"` then <Combobox.Root>, or `import { Combobox,
 * ComboboxItem }`. Root is also re-exported as `Combobox`.
 *
 * `isAddOption` / `withoutAddOption` are the pair that goes with AddOption: the row reports a
 * reserved value, and a caller asks these before treating a pick as a selection.
 */
import Root from "./combobox-root.svelte";
import Input from "./combobox-input.svelte";
import Content from "./combobox-content.svelte";
import AddOption from "./combobox-add-option.svelte";
import Item from "../select/select-item.svelte";
import Group from "../select/select-group.svelte";
import GroupHeading from "../select/select-group-heading.svelte";

export { ADD_OPTION_VALUE, addOptionLabel, isAddOption, withoutAddOption } from "./add-option.ts";

export {
  Root,
  Input,
  Content,
  AddOption,
  Item,
  Group,
  GroupHeading,
  //
  Root as Combobox,
  Input as ComboboxInput,
  Content as ComboboxContent,
  AddOption as ComboboxAddOption,
  Item as ComboboxItem,
  Group as ComboboxGroup,
  GroupHeading as ComboboxGroupHeading,
};
