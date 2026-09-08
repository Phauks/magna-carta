<script lang="ts">
  /*
   * The one field the product asks for a name's prefix and its suffixes in, wherever a person is
   * named — the New Person panel and the record's own Names pane both.
   *
   * IT IS THE PRODUCT'S DROPDOWN, NOT A TEXT BOX. Both of these were free-text inputs, which is why
   * one firm's file held "Mr", "Mr." and "mr." as three different titles, and why nobody could
   * discover that "Esq." was the spelling the firm uses. So it is a Combobox over the offered
   * spellings with the add row at the end of the list — the same control, the same gesture and the
   * same one-place-to-add-a-missing-value that every other vocabulary field in the product uses. The
   * list is never closed: the firm will meet a rank or an order nobody put on it, and what is typed
   * is added from inside the list that failed to offer it.
   *
   * A SUFFIX FIELD HOLDS AS MANY AS THE PERSON HAS. "Jr." and "Esq." are two facts about one person
   * and a field that holds one of them loses the other. So the chosen suffixes stand above the
   * control as their own rows, each removable, and the control adds another; the prefix takes one,
   * because which courtesy title a letter uses is a fact about the letter rather than the record.
   *
   * NOT `$lib/components/choice-picker.svelte`, and the difference is the whole reason this exists.
   * That field is for a CLOSED set — a set the firm did not write and cannot add to — and says so;
   * these two are open by design, so they take the Combobox with `AddOption` at the end of the list.
   * Both are the same primitive and the same gesture; only the add row separates them.
   *
   * The data-safe combobox pattern is the design system's documented one: the consumer owns the
   * input text, the typed query drives the filter, a pick writes the chosen value back, and closing
   * the listbox settles the text on what is actually held — so typed-but-unchosen text is never
   * mistaken for a value.
   */
  import * as Combobox from "@magna-carta/design-system/combobox";
  import { isAddOption } from "@magna-carta/design-system/combobox";
  import Button from "@magna-carta/design-system/button";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import X from "@lucide/svelte/icons/x";
  import { isSameAffix } from "../name-affix.ts";

  let {
    label,
    offered,
    value = $bindable(),
    values = $bindable(),
    multiple = false,
    disabled = false,
  }: {
    /** The field's own name, which is also its ghost text and the add row's noun. */
    label: string;
    /** The spellings the field offers. Never a closed set — anything typed joins the record. */
    offered: readonly string[];
    /** The single value, for a field that holds one. Bindable. */
    value?: string;
    /** The values, for a field that holds several. Bindable. */
    values?: string[];
    /** Whether the field holds several. A suffix does; a prefix does not. */
    multiple?: boolean;
    disabled?: boolean;
  } = $props();

  let query = $state("");

  const held = $derived(multiple ? (values ?? []) : []);
  /** What the control settles back to when the listbox closes: the truth, never what was typed. */
  const settled = $derived(multiple ? "" : (value ?? ""));

  // Narrowed by what is typed, and never offering a spelling already on this record — a list whose
  // rows do nothing when chosen is a list that has to be tried to be understood.
  const matching = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    return offered.filter(
      (candidate) =>
        !held.some((taken) => isSameAffix(taken, candidate)) &&
        (needle === "" || candidate.toLowerCase().includes(needle)),
    );
  });

  /** The typed spelling, matched to an offered one so a case difference is not a second value. */
  function asOffered(typed: string): string {
    return offered.find((candidate) => isSameAffix(candidate, typed)) ?? typed;
  }

  function take(chosen: string): void {
    if (multiple) {
      // The same suffix twice writes "Jr., JR" onto the firm's letters. It is already held; the
      // field simply clears, which is what a person who typed it again meant.
      if (!held.some((taken) => isSameAffix(taken, chosen))) values = [...held, chosen];
      query = "";
      return;
    }
    value = chosen;
    query = chosen;
  }

  function pick(picked: string | string[]): void {
    const chosen = Array.isArray(picked) ? (picked[0] ?? "") : picked;
    if (isAddOption(chosen)) {
      const typed = query.trim();
      if (typed !== "") take(asOffered(typed));
      return;
    }
    if (chosen === "") {
      // Deselected. A prefix clears; a suffix list is emptied a row at a time, not by this.
      if (!multiple) {
        value = "";
        query = "";
      }
      return;
    }
    take(chosen);
  }

  function drop(suffix: string): void {
    values = held.filter((taken) => taken !== suffix);
  }
</script>

<div class="flex flex-col gap-8">
  {#if multiple && held.length > 0}
    <!-- What the record holds, above the control that adds another: each one its own row, so a
         person with three of them reads three of them rather than one run-on string. -->
    <ul class="flex flex-wrap gap-4">
      {#each held as suffix (suffix)}
        <li class="flex items-center gap-4 rounded-md bg-surface-sunken py-4 ps-8 pe-4 text-sm">
          <span>{suffix}</span>
          <Button
            variant="ghost"
            size="icon"
            {disabled}
            title="Remove"
            aria-label="Remove {suffix}"
            onclick={() => drop(suffix)}
          >
            <X class="size-12" aria-hidden="true" />
          </Button>
        </li>
      {/each}
    </ul>
  {/if}

  <LabelledField {label}>
    {#snippet children({ props })}
      <Combobox.Root
        type="single"
        {disabled}
        items={matching.map((candidate) => ({ value: candidate, label: candidate }))}
        inputValue={query}
        onValueChange={pick}
        onOpenChange={(open) => {
          if (!open) query = settled;
        }}
      >
        <Combobox.Input
          {...props}
          fieldName={label}
          oninput={(event) => (query = event.currentTarget.value)}
        />
        <Combobox.Content>
          {#each matching as candidate (candidate)}
            <Combobox.Item value={candidate} label={candidate} />
          {/each}
          <Combobox.AddOption fieldName={label} {query} />
        </Combobox.Content>
      </Combobox.Root>
    {/snippet}
  </LabelledField>
</div>
