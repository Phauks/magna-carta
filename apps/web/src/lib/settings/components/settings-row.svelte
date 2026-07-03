<script lang="ts">
  /*
   * One setting definition, three renderings. A settings page renders every setting through this
   * row, and the row decides how the value appears:
   *
   * - Editable (a draft is present and the row is not read-only): the control for the setting's
   *   kind, bound to the DRAFT — edits stage, they never apply directly. The commit rail owns the
   *   moment they land.
   * - Staged: the same control, plus the staged marker — an ink dot at the row's start edge, a
   *   small-caps tag, and the old → new line. The marker renders purely from `draft.isStaged`,
   *   so staging back to the committed value removes it without any bookkeeping here.
   * - Read-only: NO control. The committed value renders as engraved text — a stated fact in the
   *   ledger voice. Never a greyed dead control: disabled controls read as broken and invite
   *   fiddling; a plainly stated value reads as what it is, a fact this member can see but not
   *   change. Read-only rows carry no draft, so the page passes the committed value directly.
   *
   * Layout: label + muted description on the start side; the control (or engraved value) on the
   * end side at a fixed comfortable measure. Rows separate by space alone — no hairlines, matching
   * the settings pages' voice.
   */
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import * as Select from "@magna-carta/design-system/select";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Switch from "@magna-carta/design-system/switch";
  import {
    settingValueLabel,
    type SettingDefinition,
    type SettingValue,
  } from "$lib/settings/settings-definitions.ts";
  import type { SettingsDraft } from "$lib/settings/settings-draft.svelte.ts";

  let {
    definition,
    draft,
    readOnly = false,
    value,
  }: {
    definition: SettingDefinition;
    draft?: SettingsDraft;
    readOnly?: boolean;
    /** The committed value for read-only rows — those carry no draft, so the page passes it. */
    value?: SettingValue;
  } = $props();

  const controlId = $derived(`settings-${definition.id}`);
  const editable = $derived(!readOnly && draft !== undefined);
  const staged = $derived(!readOnly && draft !== undefined && draft.isStaged(definition));

  // The helpers go through `draft?` rather than relying on template narrowing: the function-form
  // binds below are closures, where a `{#if draft}` narrowing would not hold.
  function stagedValue(): SettingValue {
    return draft !== undefined ? draft.stagedValue(definition) : (value ?? definition.defaultValue);
  }

  function stage(next: SettingValue): void {
    draft?.stage(definition, next);
  }

  function committedLabel(): string {
    return draft !== undefined
      ? settingValueLabel(definition, draft.value(definition))
      : settingValueLabel(definition, value ?? definition.defaultValue);
  }

  const offDefault = $derived(editable && stagedValue() !== definition.defaultValue);
  const selectItems = $derived([...(definition.options ?? [])]);
</script>

<div class="relative flex items-start justify-between gap-24">
  {#if staged}
    <!-- The staged marker's dot — supplementary to the tag and the old → new line, so hidden
         from assistive tech. Hung just outside the row's start edge so the content column keeps
         a steady left line whether or not the row is staged. -->
    <span
      aria-hidden="true"
      class="absolute size-8 rounded-full"
      style="background-color: var(--mc-accent-default); inset-inline-start: calc(-1 * var(--mc-space-16)); inset-block-start: var(--mc-space-8)"
    ></span>
  {/if}

  <div class="flex min-w-0 flex-col gap-4">
    <div class="flex items-center gap-8">
      <!-- For radio kinds there is no single control to point at; the group is labelled via
           aria-labelledby on RadioGroup.Root instead. -->
      <Label id="{controlId}-label" for={definition.kind === "radio" ? undefined : controlId}>
        {definition.label}
      </Label>
      {#if staged}
        <span
          class="text-xs text-text-muted uppercase"
          style="letter-spacing: var(--mc-tracking-caps)"
        >
          Staged
        </span>
      {/if}
    </div>
    {#if definition.description}
      <p class="text-sm text-text-muted">{definition.description}</p>
    {/if}
    {#if offDefault}
      <p class="flex items-center gap-4 text-xs text-text-muted">
        Default: {settingValueLabel(definition, definition.defaultValue)}
        <span aria-hidden="true">·</span>
        <Button
          variant="ghost"
          size="sm"
          class="text-xs"
          onclick={() => stage(definition.defaultValue)}
        >
          Reset
        </Button>
      </p>
    {/if}
  </div>

  <div class="flex shrink-0 flex-col items-end gap-4">
    {#if !editable}
      <!-- The engraved value: a fact stated in the ledger voice. -->
      <p class="text-sm font-medium tabular-nums">{committedLabel()}</p>
    {:else if definition.kind === "select"}
      <div style="inline-size: var(--mc-size-popover)">
        <Select.Root
          type="single"
          items={selectItems}
          bind:value={() => stagedValue() as string, (next) => stage(next)}
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
      </div>
    {:else if definition.kind === "radio"}
      <RadioGroup.Root
        aria-labelledby="{controlId}-label"
        bind:value={() => stagedValue() as string, (next) => stage(next)}
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
        bind:checked={() => stagedValue() === true, (next) => stage(next)}
      />
    {:else}
      <div style="inline-size: var(--mc-size-popover)">
        <Input
          id={controlId}
          bind:value={() => String(stagedValue()), (next) => stage(next ?? "")}
        />
      </div>
    {/if}
    {#if staged && draft !== undefined}
      <p class="text-xs text-text-muted">
        {committedLabel()} → {settingValueLabel(definition, stagedValue())}
      </p>
    {/if}
  </div>
</div>
