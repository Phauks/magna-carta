<script lang="ts">
  /*
   * One setting, one engraved-table row — one anatomy, three postures. Every row on a page
   * shares a REAL column grid, so the controls form a solid vertical edge instead of ragged
   * floating text:
   *
   *   [marker gutter, fixed, always present]
   *   [label + one-line muted description, flexible]
   *   [tag slot, fixed — "Staged" when staged, empty otherwise]
   *   [control column, fixed inline-size, right edges aligned]
   *
   * The gutter and tag slot exist in EVERY posture: state changes ink, never geometry, so
   * staging a value cannot reflow the table.
   *
   * Postures (exactly one prop group applies):
   * - draft: the control binds to the page draft — edits stage, nothing lands until the header
   *   band commits. Staged rows light the gutter's gilt bar, take the "Staged" tag, show the old
   *   value struck through (the ledger's own grammar: strike and re-enter, never erase), and
   *   grow a quiet per-row revert.
   * - instant: the control binds to a live value and applies on interaction — the page owns the
   *   apply (and its history append).
   * - read-only (`value` alone): NO control — the committed value engraves as a stated fact.
   *   Never a greyed dead control: disabled controls read as broken and invite fiddling; a
   *   plainly stated value reads as what it is, a fact this member can see but not change. When
   *   the page passes onRequestChange, a quiet request affordance lives in the control column —
   *   revealed on row hover and on focus (screen readers always reach it), so the resting table
   *   stays calm.
   */
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import * as Select from "@magna-carta/design-system/select";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Switch from "@magna-carta/design-system/switch";
  import Undo2 from "@lucide/svelte/icons/undo-2";
  import {
    settingValueLabel,
    type SettingDefinition,
    type SettingValue,
  } from "$lib/settings/settings-definitions.ts";
  import type { SettingsDraft } from "$lib/settings/settings-draft.svelte.ts";

  let {
    definition,
    draft,
    instant,
    value,
    onRequestChange,
  }: {
    definition: SettingDefinition;
    /** Draft posture: edits stage into this page draft. */
    draft?: SettingsDraft;
    /** Instant posture: the live value and the apply the control drives directly. */
    instant?: { readonly value: SettingValue; readonly apply: (next: SettingValue) => void };
    /** Read-only posture: the committed value to engrave (no draft carries it in that mode). */
    value?: SettingValue;
    /** Read-only rows only: mounts the per-row "Request a change" affordance. */
    onRequestChange?: (definition: SettingDefinition) => void;
  } = $props();

  const controlId = $derived(`settings-${definition.id}`);
  const editable = $derived(draft !== undefined || instant !== undefined);
  const staged = $derived(draft !== undefined && draft.isStaged(definition));
  // The row is interactive when it carries a control or a per-row action — those rows take the
  // full-width hover tint; purely stated rows stay still.
  const interactive = $derived(editable || onRequestChange !== undefined);

  // The helpers go through `draft?`/`instant?` rather than template narrowing: the function-form
  // binds below are closures, where an `{#if draft}` narrowing would not hold.
  function currentValue(): SettingValue {
    if (draft !== undefined) return draft.stagedValue(definition);
    if (instant !== undefined) return instant.value;
    return value ?? definition.defaultValue;
  }

  function applyNext(next: SettingValue): void {
    if (draft !== undefined) {
      draft.stage(definition, next);
      return;
    }
    instant?.apply(next);
  }

  function committedLabel(): string {
    return draft !== undefined
      ? settingValueLabel(definition, draft.value(definition))
      : settingValueLabel(definition, value ?? definition.defaultValue);
  }

  // Reverting stages the committed value back; the draft treats that as an un-stage, so the
  // marker, tag, and strike clear themselves.
  function revert(): void {
    if (draft === undefined) return;
    draft.stage(definition, draft.value(definition));
  }

  const selectItems = $derived([...(definition.options ?? [])]);
</script>

<div
  id="settings-row-{definition.id}"
  class="group relative flex items-start gap-16 py-12 {interactive
    ? 'hover:bg-surface-raised'
    : ''}"
>
  <!-- Marker gutter: permanently reserved, so the gilt bar lights without reflow. The bar spans
       the row rule-to-rule (absolute against the row, outside its block padding); it is
       supplementary to the tag and the struck value, so hidden from assistive tech. -->
  <div class="shrink-0" style="inline-size: var(--mc-space-16)">
    {#if staged}
      <span
        aria-hidden="true"
        class="absolute inset-y-0"
        style="inset-inline-start: var(--mc-space-0); inline-size: var(--mc-focus-ring-width); background-color: var(--mc-accent-default)"
      ></span>
    {/if}
  </div>

  <div class="flex min-w-0 grow flex-col gap-4">
    <!-- For radio kinds there is no single control to point at; the group is labelled via
         aria-labelledby on RadioGroup.Root instead. -->
    <Label id="{controlId}-label" for={definition.kind === "radio" ? undefined : controlId}>
      {definition.label}
    </Label>
    {#if definition.description}
      <p class="text-sm text-text-muted">{definition.description}</p>
    {/if}
  </div>

  <!-- The fixed tag slot — geometry never changes, only whether the tag is inked. -->
  <div class="shrink-0 pt-4 text-end" style="inline-size: var(--mc-space-64)">
    {#if staged}
      <span
        class="text-xs text-text-muted uppercase"
        style="letter-spacing: var(--mc-tracking-caps)"
      >
        Staged
      </span>
    {/if}
  </div>

  <!-- The control column — fixed measure, so every row's control shares the same right edge. -->
  <div class="flex shrink-0 flex-col items-end gap-4" style="inline-size: var(--mc-size-popover)">
    {#if !editable}
      <!-- The engraved value: a fact stated in the ledger voice, at the column's right edge. -->
      <p class="text-sm font-medium tabular-nums">{committedLabel()}</p>
      {#if onRequestChange !== undefined}
        <!-- Quiet at rest, never absent: sr-only keeps the button reachable (keyboard and screen
             reader), and hovering the row or focusing the button reveals it in place. -->
        <Button
          variant="ghost"
          size="sm"
          class="sr-only group-hover:not-sr-only group-focus-within:not-sr-only"
          onclick={() => onRequestChange?.(definition)}
        >
          Request a change
        </Button>
      {/if}
    {:else if definition.kind === "select"}
      <Select.Root
        type="single"
        items={selectItems}
        bind:value={() => currentValue() as string, (next) => applyNext(next)}
        allowDeselect={false}
      >
        <Select.Trigger id={controlId} class="w-full">
          <Select.Value placeholder="Select" />
        </Select.Trigger>
        <Select.Content>
          {#each selectItems as option (option.value)}
            <Select.Item value={option.value} label={option.label} />
          {/each}
        </Select.Content>
      </Select.Root>
    {:else if definition.kind === "radio"}
      <RadioGroup.Root
        class="w-full"
        aria-labelledby="{controlId}-label"
        bind:value={() => currentValue() as string, (next) => applyNext(next)}
      >
        {#each definition.options ?? [] as option (option.value)}
          <div class="flex items-center gap-8">
            <RadioGroup.Item value={option.value} id="{controlId}-{option.value}" />
            <Label for="{controlId}-{option.value}">{option.label}</Label>
          </div>
        {/each}
      </RadioGroup.Root>
    {:else if definition.kind === "switch"}
      <Switch
        id={controlId}
        bind:checked={() => currentValue() === true, (next) => applyNext(next)}
      />
    {:else}
      <Input id={controlId} bind:value={() => String(currentValue()), (next) => applyNext(next ?? "")} />
    {/if}

    {#if staged}
      <!-- Strike and re-enter, never erase: the superseded value stays legible under the strike
           while the staged value lives in the control above. -->
      <p class="text-xs text-text-muted tabular-nums line-through">{committedLabel()}</p>
      <Button variant="ghost" size="sm" onclick={revert}>
        <Undo2 class="size-16" aria-hidden="true" />
        Revert
      </Button>
    {/if}
  </div>
</div>
