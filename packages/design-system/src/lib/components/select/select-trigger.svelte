<script lang="ts">
  /*
   * Select.Trigger — the styled control that opens the listbox. Unlike a DropdownMenu/Popover trigger
   * (a caller-styled button), a Select trigger IS a form control: it carries the mc-select-trigger
   * recipe (an input-like box that shares the Input focus shape) and a trailing ChevronDown (Lucide,
   * deep-imported). Bits sets `data-placeholder` when nothing is selected (the recipe mutes the text)
   * and `data-state="open"|"closed"`; behaviour, a11y (aria-haspopup, aria-expanded, typeahead,
   * keyboard open) come from Bits. The caller renders the Value as children. Like Input/Textarea, the
   * control is `w-full` (it fills its container — size it with a wrapper); the recipe owns only the look.
   *
   * TYPING NARROWS A LONG LIST. Focus stays on this trigger while the list is open, so the keys a
   * person types arrive here. On a searchable list (select-search.svelte.ts) a letter, a digit, a
   * space after the first letter and Backspace edit the query instead of reaching Bits' jump-to-
   * letter, and Escape clears a query before it closes anything. Each edit then asks Bits to
   * highlight the first row still standing (a Home key), so Enter chooses the top match. Arrows,
   * Enter, Tab and a closed list are left entirely to Bits.
   */
  import { Select as SelectPrimitive } from "bits-ui";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { Snippet } from "svelte";
  import type { WithoutChild } from "../../internal/types.ts";
  import { tick } from "svelte";
  import { getSelectSearch } from "./select-search.svelte.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    onkeydown,
    ...restProps
  }: WithoutChild<SelectPrimitive.TriggerProps> & { children?: Snippet } = $props();

  const search = getSelectSearch();

  /** The query after this key, or null when the key is not one that edits it. */
  function editedQuery(event: KeyboardEvent, query: string): string | null {
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return null;
    if (event.key === "Backspace") return query === "" ? null : query.slice(0, -1);
    if (event.key === " ") return query === "" ? null : `${query} `;
    return event.key.length === 1 ? query + event.key : null;
  }

  function narrow(event: KeyboardEvent & { currentTarget: EventTarget & HTMLButtonElement }): void {
    onkeydown?.(event);
    if (event.defaultPrevented || search === undefined) return;
    if (!search.searchable || !search.isOpen) return;
    if (event.key === "Escape" && search.query !== "") {
      event.preventDefault();
      event.stopPropagation();
      search.clear();
      return;
    }
    const next = editedQuery(event, search.query);
    if (next === null) return;
    // A cancelled keydown skips Bits' own handler, which would otherwise jump to the letter.
    event.preventDefault();
    search.query = next;
    const trigger = event.currentTarget;
    void tick().then(() => {
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    });
  }
</script>

<SelectPrimitive.Trigger
  bind:ref
  class={mergeClasses("mc-select-trigger w-full", className)}
  onkeydown={narrow}
  {...restProps}
>
  {@render children?.()}
  <ChevronDown class="mc-select-trigger-icon" aria-hidden="true" />
</SelectPrimitive.Trigger>
