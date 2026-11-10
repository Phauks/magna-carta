<script lang="ts">
  /*
   * MergeFieldPicker — Tier 4 (Bits UI), composed from two components this package already has: a
   * Popover for the floating panel and a Command for the searchable, grouped listbox inside it. It
   * adds no new floating, filtering, or listbox machinery (golden rule 1); what it adds is the row
   * shape a merge field needs and the grouping by source.
   *
   * The premise: nobody types a key path from memory. A person picks a field the way they think
   * about it — "the client's mailing address", under Parties — so a row leads with the human label,
   * carries the value type, and explains itself in one line. The key is search vocabulary
   * (option-grouping.ts) so someone who does know it can still type it, but it is never the subject.
   *
   * A picker HOLDS A VALUE (the chosen field's key), so it is an Input in the catalog taxonomy.
   * `value` is bindable; `onSelect` fires with the whole option for a caller that wants to insert a
   * chip rather than hold a selection.
   *
   * Labelling is the caller's: the trigger's accessible name comes from an `aria-label` or
   * `aria-labelledby` passed through, because a picker sits in a form field whose label already
   * exists. Validation state rides `invalid`, which sets `aria-invalid` and the danger edge.
   */
  import ChevronsUpDown from "@lucide/svelte/icons/chevrons-up-down";
  import * as Command from "../command/index.ts";
  import * as Popover from "../popover/index.ts";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import {
    findPickerOption,
    groupPickerOptions,
    pickerFilterScore,
    pickerOptionKeywords,
  } from "./option-grouping.ts";
  import type { MergeFieldPickerOption } from "./types.ts";

  let {
    options,
    value = $bindable(null),
    open = $bindable(false),
    placeholder = "Choose a merge field",
    searchPlaceholder = "Search merge fields",
    searchLabel = "Search merge fields",
    emptyMessage = "No merge field matches that search.",
    disabled = false,
    invalid = false,
    onSelect,
    class: className,
    ...restProps
  }: {
    /** Every field on offer. Group order is the caller's — the picker preserves it. */
    options: readonly MergeFieldPickerOption[];
    /** The chosen field's key, or null. Bindable. */
    value?: string | null;
    /** Whether the panel is open. Bindable. */
    open?: boolean;
    /** Trigger text while nothing is chosen. */
    placeholder?: string;
    /** Hint text in the search field. */
    searchPlaceholder?: string;
    /** Accessible name for the search listbox. */
    searchLabel?: string;
    /** Shown when the query matches nothing. */
    emptyMessage?: string;
    /** Disables the trigger so no field can be chosen. */
    disabled?: boolean;
    /** Marks the field as failing validation — sets aria-invalid and the danger edge. */
    invalid?: boolean;
    /** Fires with the whole option on selection, for a caller inserting rather than holding. */
    onSelect?: (option: MergeFieldPickerOption) => void;
    class?: string;
    // Labelling attributes (aria-label / aria-labelledby / id) reach the trigger through here.
    [attribute: string]: unknown;
  } = $props();

  const sections = $derived(groupPickerOptions(options));
  const selected = $derived(findPickerOption(options, value));

  function choose(option: MergeFieldPickerOption): void {
    value = option.key;
    open = false;
    onSelect?.(option);
  }
</script>

<!-- The trigger is a select-only combobox, the role the Select trigger takes: it holds a value and
     shows it, so its name is the field it fills ("Merge field") and the chosen field is its value.
     As a button the shown value would be its content, and a name has to contain the words a
     reader can see on a control, which a field's label never does once a value is chosen. -->
<Popover.Root bind:open>
  <Popover.Trigger
    role="combobox"
    {disabled}
    aria-invalid={invalid ? "true" : undefined}
    data-invalid={invalid ? "" : undefined}
    data-placeholder={selected ? undefined : ""}
    class={mergeClasses("mc-merge-field-picker-trigger w-full", className)}
    {...restProps}
  >
    <span class="mc-merge-field-picker-trigger-label">{selected?.label ?? placeholder}</span>
    {#if selected}
      <span class="mc-merge-field-picker-trigger-type">{selected.valueTypeLabel}</span>
    {/if}
    <ChevronsUpDown class="mc-merge-field-picker-trigger-icon" aria-hidden="true" />
  </Popover.Trigger>

  <Popover.Content class="mc-merge-field-picker-content w-80 p-0">
    <Command.Root label={searchLabel} filter={pickerFilterScore} class="border-0 bg-transparent">
      <Command.Input placeholder={searchPlaceholder} />
      <Command.List class="max-h-64">
        <Command.Viewport>
          <Command.Empty>{emptyMessage}</Command.Empty>
          {#each sections as section (section.group)}
            <Command.Group>
              <Command.GroupHeading>{section.label}</Command.GroupHeading>
              <Command.GroupItems>
                {#each section.options as option (option.key)}
                  <Command.Item
                    value={option.key}
                    keywords={pickerOptionKeywords(option)}
                    disabled={option.disabled}
                    onSelect={() => choose(option)}
                    class="mc-merge-field-picker-item"
                  >
                    <span class="mc-merge-field-picker-item-text">
                      <span class="mc-merge-field-picker-item-label">{option.label}</span>
                      {#if option.description}
                        <span class="mc-merge-field-picker-item-description">
                          {option.description}
                        </span>
                      {/if}
                    </span>
                    <span class="mc-merge-field-picker-item-type">{option.valueTypeLabel}</span>
                  </Command.Item>
                {/each}
              </Command.GroupItems>
            </Command.Group>
          {/each}
        </Command.Viewport>
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
