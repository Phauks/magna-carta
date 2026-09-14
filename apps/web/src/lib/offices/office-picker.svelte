<script lang="ts">
  /*
   * The one field for choosing an office — on a new matter, on a resource, on a member, wherever
   * one of the firm's offices is named.
   *
   * A COMBOBOX, on the product's rule that every closed choice takes typing, and it SHOWS WHAT IT
   * HOLDS AT REST: arriving in the field starts a fresh search over every open office, leaving it
   * puts the chosen office's name back, so typed-but-unchosen text is never mistaken for a value.
   * Same discipline as $lib/components/choice-picker.svelte, which this cannot simply be because an
   * office is one of the firm's own RECORDS, and here "none" is a real answer: a matter with no
   * office is valid on the contract, so the field can be emptied and says so.
   *
   * IT READS THE FIRM'S OFFICES ITSELF, once, through the shared store, so a surface that names an
   * office does not have to know how offices are read. A caller that already holds the list — a
   * form that read it for something else — passes it in and the store is not consulted.
   */
  import * as Combobox from "@magna-carta/design-system/combobox";
  import { firmOffices } from "./firm-offices.svelte.ts";
  import { officeCitation } from "./office-vocabulary.ts";
  import type { OfficeSummary } from "./offices-api.ts";

  let {
    offices,
    value = $bindable(null),
    inputId,
    label = "Office",
    disabled = false,
    title,
    whenEmpty = "No offices are set up.",
    onchange,
  }: {
    /** The offices to offer. Omitted, the open ones from the firm's own list. */
    offices?: readonly OfficeSummary[];
    /** The chosen office's handle, or null for none. Bindable. */
    value?: string | null;
    /** The input's id, so the caller's Label points at it. */
    inputId?: string;
    /** The field's own name, which is also its ghost text. */
    label?: string;
    disabled?: boolean;
    /** What the field says on its hover, which is where a refusal is worded. */
    title?: string;
    /** What to say when the firm has no office to offer. */
    whenEmpty?: string;
    onchange?: (value: string | null) => void;
  } = $props();

  $effect(() => {
    if (offices === undefined) void firmOffices.load(fetch);
  });

  const offered = $derived(offices ?? firmOffices.active);

  let query = $state("");
  let searching = $state(false);

  const chosen = $derived(offered.find((office) => office.id === value));
  const chosenLabel = $derived(chosen?.name ?? "");

  const matching = $derived.by(() => {
    const needle = searching ? query.trim().toLowerCase() : "";
    if (needle === "") return offered;
    return offered.filter(
      (office) =>
        office.name.toLowerCase().includes(needle) ||
        officeCitation(office).toLowerCase().includes(needle),
    );
  });

  function settle(): void {
    searching = false;
    query = "";
  }

  function pick(picked: string | string[]): void {
    const next = Array.isArray(picked) ? (picked[0] ?? "") : picked;
    settle();
    const chosenId = next === "" ? null : next;
    if (chosenId === value) return;
    value = chosenId;
    onchange?.(chosenId);
  }
</script>

{#if offered.length === 0 && (offices !== undefined || firmOffices.offices !== null)}
  <p class="text-xs text-text-muted">{firmOffices.failure ?? whenEmpty}</p>
{:else}
  <Combobox.Root
    type="single"
    {disabled}
    items={matching.map((office) => ({ value: office.id, label: office.name }))}
    value={value ?? ""}
    inputValue={searching ? query : chosenLabel}
    onValueChange={pick}
    onOpenChange={(open) => {
      if (!open) settle();
    }}
  >
    <Combobox.Input
      id={inputId}
      fieldName={label}
      {title}
      autocomplete="off"
      spellcheck={false}
      onfocus={() => {
        searching = true;
        query = "";
      }}
      onblur={settle}
      oninput={(event) => {
        searching = true;
        query = event.currentTarget.value;
      }}
    />
    <Combobox.Content>
      {#each matching as office (office.id)}
        <Combobox.Item value={office.id} label={office.name}>
          <span class="flex items-baseline gap-8">
            <span>{office.name}</span>
            {#if officeCitation(office) !== ""}
              <span class="text-xs text-text-muted">{officeCitation(office)}</span>
            {/if}
          </span>
        </Combobox.Item>
      {/each}
      {#if matching.length === 0}
        <Combobox.Group>
          <Combobox.GroupHeading>No office matches "{query.trim()}".</Combobox.GroupHeading>
        </Combobox.Group>
      {/if}
    </Combobox.Content>
  </Combobox.Root>
{/if}
