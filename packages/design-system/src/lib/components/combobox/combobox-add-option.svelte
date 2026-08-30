<script lang="ts">
  /*
   * Combobox.AddOption — the last row of a listbox over a vocabulary the firm owns: it adds whatever
   * is typed in the field, from inside the list that failed to offer it.
   *
   * It is a real option row rather than a button below the list, for three reasons that all point the
   * same way: the panel is a listbox, and a listbox's children are options (a button among them is
   * both invalid and unreachable by the arrow keys people are already using); the row must be
   * reachable by keyboard, which it gets for free by being an option; and a listbox that has narrowed
   * to nothing is exactly when this row matters, so it is also the row that keeps an empty result
   * from being a dead end.
   *
   * Choosing it reports the reserved value. The caller answers `isAddOption` in its value handler,
   * creates the entry from the query it already owns, and then writes the real value back — the
   * component cannot do that step, because only the caller knows where the vocabulary lives.
   *
   * Two details that are easy to get wrong and were:
   *
   * The row's TEXT and the row's LABEL are different strings on purpose. Bits writes the chosen row's
   * label into the field, which for an ordinary row is exactly right and for this one would leave the
   * field reading `Add "Affidavit"` instead of `Affidavit`. So the label is the typed value — what the
   * field should end up holding — and the sentence a person reads is the row's rendered text.
   *
   * With nothing typed the row is visible but not choosable: it states what it is for, and there is
   * genuinely nothing to add yet. Rendering it and muting it is the honest answer — hiding it until a
   * keystroke would mean the way to add a value is a thing you can only find by accident.
   */
  import Item from "../select/select-item.svelte";
  import { ADD_OPTION_VALUE, addOptionLabel } from "./add-option.ts";
  import { mergeClasses } from "../../internal/merge-classes.ts";

  let {
    fieldName,
    query = "",
    class: className,
  }: {
    /** The field's own name, as it is written beside the control: "Payee", "Document Type". */
    fieldName: string;
    /** What is currently typed in the field. The row names it, so the row says what it will add. */
    query?: string;
    /** Extra classes for the row. */
    class?: string;
  } = $props();

  const typed = $derived(query.trim());
  const rowText = $derived(addOptionLabel(fieldName, query));
</script>

<Item
  value={ADD_OPTION_VALUE}
  label={typed}
  disabled={typed === ""}
  class={mergeClasses("mc-combobox-add-option", className)}
>
  {rowText}
</Item>
