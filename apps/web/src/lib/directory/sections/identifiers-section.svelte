<script lang="ts">
  /*
   * The sealed identifiers a record holds, and the row that seals another.
   *
   * A list of sealed things can still say what it holds: the type, the plaintext part beside it
   * (the state that issued a licence, who an account is held with), and bullets where the value
   * is. The add row asks the type first, and the type decides the fields — a social security
   * number is nine digits that format as typed; an account is who it is held with, a number, a
   * username and a secret — each checked by the shape the API checks, so the plus is live only for
   * a value that will be accepted.
   *
   * Data-blind: it lists what it is given and hands a checked draft to whoever owns the record. A
   * pane that can reveal a value renders its own control through `rowEnd`; the dialog, whose values
   * are not yet sealed, renders nothing there.
   */
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import PasswordInput from "@magna-carta/design-system/password-input";
  import * as Select from "@magna-carta/design-system/select";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import Lock from "@lucide/svelte/icons/lock";
  import Plus from "@lucide/svelte/icons/plus";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type { Snippet } from "svelte";
  import type { DirectoryEntityKind, DirectoryIdentifierType } from "../directory-api.ts";
  import { identifierShapesFor } from "../directory-vocabulary.ts";
  import {
    emptyIdentifierDraft,
    identifierDraftFields,
    identifierDraftRefusal,
    identifierDraftStarted,
    identifierNumberAsTyped,
    type IdentifierDraft,
    type IdentifierRow,
  } from "../identifier-draft.ts";
  import SectionHeading from "./section-heading.svelte";

  let {
    rows,
    kind,
    canEdit = true,
    editDisabledReason,
    onAdd,
    onRemove,
    shownValue,
    rowEnd,
  }: {
    rows: readonly IdentifierRow[];
    kind: DirectoryEntityKind;
    canEdit?: boolean;
    editDisabledReason?: string;
    onAdd: (draft: IdentifierDraft) => void;
    onRemove?: (row: IdentifierRow) => void;
    /** What the value column shows instead of bullets — a revealed value, or a state word. */
    shownValue?: (row: IdentifierRow) => string | null;
    /** The row's own controls, for an owner that can reveal. */
    rowEnd?: Snippet<[IdentifierRow]>;
  } = $props();

  const identity = $props.id();
  const typeLabelId = `${identity}-type`;

  const shapes = $derived(identifierShapesFor(kind));
  const typeItems = $derived(shapes.map((shape) => ({ value: shape.type, label: shape.label })));

  let draft = $state<IdentifierDraft>(emptyIdentifierDraft("ssn"));

  $effect(() => {
    // The first type the kind offers, whenever the kind changes under the section.
    const first = shapes[0]?.type;
    if (first !== undefined && !shapes.some((shape) => shape.type === draft.type)) {
      draft = emptyIdentifierDraft(first);
    }
  });

  function startDraft(type: DirectoryIdentifierType): void {
    draft = emptyIdentifierDraft(type);
  }

  function patch(changes: Partial<IdentifierDraft>): void {
    draft = { ...draft, ...changes };
  }

  const fields = $derived(identifierDraftFields(draft.type));
  const refusal = $derived(identifierDraftRefusal(draft));
  const started = $derived(identifierDraftStarted(draft));

  function add(): void {
    if (refusal !== null || !canEdit) return;
    onAdd(draft);
    draft = emptyIdentifierDraft(draft.type);
  }

  function widthOf(key: "label" | "number" | "username" | "secret"): string {
    return key === "label" ? "minmax(9rem, 1fr)" : key === "number" ? "minmax(9rem, 1.2fr)" : "minmax(7rem, 1fr)";
  }
</script>

<section class="flex flex-col gap-12">
  <SectionHeading label="Sealed Identifiers" count={rows.length} />

  {#if rows.length > 0}
    <ul class="flex flex-col">
      {#each rows as row (row.id)}
        {@const shown = shownValue?.(row) ?? null}
        <li class="flex items-center gap-8 border-b border-border-default py-4">
          <Lock class="size-16 shrink-0 text-text-muted" aria-hidden="true" />
          <span class="flex min-w-0 flex-auto flex-wrap items-baseline gap-x-8">
            <span>{row.typeLabel}</span>
            {#if row.label !== null}
              <span class="text-xs text-text-muted">{row.label}</span>
            {/if}
          </span>
          <span class="shrink-0 text-sm tabular-nums" class:text-text-muted={shown === null}>
            {shown ?? row.masked}
          </span>
          {#if rowEnd !== undefined}
            {@render rowEnd(row)}
          {/if}
          {#if onRemove !== undefined}
            <Button
              variant="ghost"
              size="icon"
              disabled={!canEdit}
              title={editDisabledReason ?? "Remove"}
              aria-label="Remove the {row.typeLabel.toLowerCase()}"
              onclick={() => onRemove?.(row)}
            >
              <Trash2 class="size-16" aria-hidden="true" />
            </Button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <!-- The type first; the fields it decides; the plus live once the value fits its shape. -->
  <div class="flex flex-col gap-12 rounded-md border border-border-default bg-surface-raised p-12">
    <div class="grid items-end gap-8" style="grid-template-columns: 12rem {fields.map((field) => widthOf(field.key)).join(' ')} auto">
      <div class="flex flex-col gap-8">
        <Label id={typeLabelId}>Type</Label>
        <Select.Root
          type="single"
          items={typeItems}
          bind:value={() => draft.type, (chosen) => startDraft(chosen as DirectoryIdentifierType)}
          allowDeselect={false}
          disabled={!canEdit}
        >
          <Select.Trigger aria-labelledby={typeLabelId}>
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {#each typeItems as item (item.value)}
              <Select.Item value={item.value} label={item.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
      {#each fields as field (field.key)}
        <!-- The refusal sits on the number, the field every type has and the one it is usually
             about; it appears once something has been typed, so a blank row is not nagged. -->
        <LabelledField
          label={field.label}
          error={field.key === "number" && started && refusal !== null ? refusal : undefined}
        >
          {#snippet children({ props })}
            {#if field.entry === "secret"}
              <PasswordInput
                {...props}
                autocomplete="new-password"
                value={draft.secret}
                disabled={!canEdit}
                showLabel="Show the secret"
                hideLabel="Hide the secret"
                oninput={(event) => patch({ secret: event.currentTarget.value })}
              />
            {:else}
              <Input
                {...props}
                inputmode={field.entry === "digits" ? "numeric" : undefined}
                autocomplete="off"
                class={field.entry === "digits" ? "tabular-nums" : undefined}
                value={draft[field.key]}
                disabled={!canEdit}
                placeholder={placeholderOf(field.label)}
                oninput={(event) => {
                  const typed =
                    field.key === "number"
                      ? identifierNumberAsTyped(draft.type, event.currentTarget.value)
                      : event.currentTarget.value;
                  if (field.key === "number") event.currentTarget.value = typed;
                  patch({ [field.key]: typed });
                }}
              />
            {/if}
          {/snippet}
        </LabelledField>
      {/each}
      <Button
        variant="secondary"
        size="icon"
        disabled={!canEdit || refusal !== null}
        title={editDisabledReason ?? refusal ?? "Seal"}
        aria-label="Seal this identifier"
        onclick={add}
      >
        <Plus class="size-16" aria-hidden="true" />
      </Button>
    </div>
  </div>
</section>
