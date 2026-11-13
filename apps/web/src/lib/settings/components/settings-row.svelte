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
   * THE ROW'S GEOMETRY INVARIANT: rest, hover, and staged all share IDENTICAL geometry. The
   * marker gutter, the tag slot, and the Was + Revert line under the control are permanently
   * reserved in every posture — state changes ink and visibility, never layout — so staging
   * (or revealing) anything can never push the rows below it.
   *
   * Postures (exactly one prop group applies):
   * - draft: the control binds to the page draft — edits stage, nothing lands until the
   *   masthead's meta bar commits. Staged rows light the gutter's gilt bar, take the "Staged"
   *   tag, and carry one compact line under the control: the previous value in a quiet "Was:"
   *   badge (re-entered, never erased) with Revert beside it.
   * - instant: the control binds to a live value and applies on interaction — the page owns the
   *   apply (and its history append).
   * - read-only (`value` alone): NO control — the committed value engraves as a stated fact.
   *   Never a greyed dead control: disabled controls read as broken and invite fiddling; a
   *   plainly stated value reads as what it is, a fact this member can see but not change. When
   *   the page passes onRequestChange, a quiet request affordance lives in the control column —
   *   revealed on row hover and on focus (screen readers always reach it), so the resting table
   *   stays calm.
   */
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import Badge from "@magna-carta/design-system/badge";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Switch from "@magna-carta/design-system/switch";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import MessageSquarePlus from "@lucide/svelte/icons/message-square-plus";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import type { ChoiceOption } from "$lib/components/choice-picker.ts";
  import {
    settingValueLabel,
    type SettingDefinition,
    type SettingValue,
  } from "$lib/settings/settings-definitions.ts";
  import type { SettingsDraft } from "$lib/settings/settings-draft.svelte.ts";
  import type { Snippet } from "svelte";

  let {
    definition,
    draft,
    instant,
    value,
    onRequestChange,
    control,
    choiceRow,
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
    /**
     * Bespoke control-column content (e.g. a seam row's Soon device) — the row still supplies
     * the shared grid, label, and description, so one-off rows never re-implement the anatomy.
     */
    control?: Snippet;
    /**
     * How each option of a `select` row draws itself in the open list, where the label alone is
     * not the whole choice (the Font Family row sets each face in itself). The field keeps the
     * plain label at rest.
     */
    choiceRow?: Snippet<[ChoiceOption]>;
  } = $props();

  const controlId = $derived(`settings-${definition.id}`);
  // Nothing and "   " are one state: a row either carries a sentence or it does not.
  const descriptor = $derived(
    definition.description === undefined || definition.description.trim() === ""
      ? undefined
      : definition.description,
  );
  const editable = $derived(draft !== undefined || instant !== undefined);
  const staged = $derived(draft !== undefined && draft.isStaged(definition));
  // The row is interactive when it carries a control or a per-row action — those rows take the
  // full-width hover tint; purely stated rows (and bespoke seam content) stay still.
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

  /*
   * A closed choice is the product's combobox, never a select (docs/conventions/design-corrections.md,
   * "Every closed choice is a combobox"): the setting's declaration says it is a `select` kind, and
   * the shape that follows from that is the one field every closed choice in the product uses —
   * typing narrows it, and it shows what it holds at rest. The page never chooses the control.
   */
  const choiceOptions = $derived<readonly ChoiceOption[]>(
    (definition.options ?? []).map((option) => ({ value: option.value, label: option.label })),
  );
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
    <!-- text-md (owner-directed): the setting's NAME leads the row by size, not weight alone;
         the description stays sm and muted. -->
    <Label id="{controlId}-label" class="text-md" for={controlId}>
      {definition.label}
    </Label>
    <!-- The descriptor, only where there is one. A definition that states none renders the label
         alone rather than an empty line holding space open — see SettingDefinition.description for
         when a row earns a sentence and when the sentence is noise. -->
    {#if descriptor !== undefined}
      <p class="text-sm text-text-muted">{descriptor}</p>
    {/if}
  </div>

  <!-- The fixed tag slot — geometry never changes, only whether the tag is inked. -->
  <div class="shrink-0 pt-4 text-end" style="inline-size: var(--mc-space-64)">
    {#if staged}
      <FieldLabel as="span"
      >
        Staged
      </FieldLabel>
    {/if}
  </div>

  <!-- The control column — fixed measure, so every row's control shares the same right edge. -->
  <div class="flex shrink-0 flex-col items-end gap-4" style="inline-size: var(--mc-size-popover)">
    {#if control !== undefined}
      <div class="flex items-center justify-end gap-8 pe-8">
        {@render control()}
      </div>
    {:else if !editable}
      <!-- pe-8 insets the whole group from the table's edge rule (owner: the button "hugs the
           edge"); gap-8 seats the button one step after the value. -->
      <div class="flex items-center justify-end gap-8 pe-8">
        <!-- The engraved value: a fact stated in the ledger voice, at the column's right edge. -->
        <p class="text-sm font-medium tabular-nums">{committedLabel()}</p>
        {#if onRequestChange !== undefined}
          <!-- The per-row request affordance: an icon-only ghost button in the square `icon`
               size, so the hover tint sits concentric around the glyph (the same device as the
               canvas icon buttons — never a lopsided pad).

               ALWAYS IN LAYOUT, hidden by INK: the button keeps its full box at rest and only
               its color is transparent, revealed by row hover or its own keyboard focus — so
               revealing it can never grow the row (owner defect: sr-only re-entered the flow on
               reveal and reflowed the line). visibility:hidden would also hold geometry but
               removes the button from the tab order, killing the keyboard reveal — hide-by-color
               is the house pattern for exactly this (the sidebar labels and brand wordmark hide
               the same way). The focus side pairs with request-change-dialog.svelte cancelling
               Bits' focus restore on close, so the reveal cannot latch open after backing out.

               Tooltip.Trigger IS the button element (Bits renders it as one), so it wears the
               ghost recipe directly — nesting a Button inside it would render button-in-button. -->
          <Tooltip.Root>
            <Tooltip.Trigger
              class="{buttonClasses({
                variant: 'ghost',
                size: 'icon',
              })} text-transparent group-hover:text-text-default focus-visible:text-text-default"
              aria-label="Request a change to {definition.label}"
              onclick={() => onRequestChange?.(definition)}
            >
              <MessageSquarePlus class="size-16" aria-hidden="true" />
            </Tooltip.Trigger>
            <Tooltip.Content>Request a change</Tooltip.Content>
          </Tooltip.Root>
        {/if}
      </div>
    {:else if definition.kind === "select"}
      <ChoicePicker
        options={choiceOptions}
        inputId={controlId}
        label={definition.label}
        row={choiceRow}
        bind:value={() => String(currentValue()), (next) => applyNext(next)}
      />
    {:else if definition.kind === "switch"}
      <Switch
        id={controlId}
        bind:checked={() => currentValue() === true, (next) => applyNext(next)}
      />
    {:else if definition.kind === "number"}
      <!-- A native number field carrying the definition's own bounds, so the browser refuses out
           of range before a request is composed. The bounds are the SAME interval the backend's
           setting schema enforces at the write path — the field is the polite statement of a rule
           the server keeps regardless. An emptied field is not staged as a change: `next` is the
           empty string while somebody is retyping, and staging 0 mid-keystroke would silently
           propose a real value (a ceiling of nothing) they never chose. -->
      <Input
        id={controlId}
        type="number"
        inputmode="numeric"
        min={definition.minimum}
        max={definition.maximum}
        step={1}
        class="tabular-nums"
        bind:value={
          () => String(currentValue()),
          (next) => {
            // A number field hands back whatever the runtime coerced it to — a number where the
            // native `type` coercion applied, the raw string where it did not (Input spreads `type`
            // through its rest props, so that is not statically decidable here), and undefined or ""
            // for an emptied field. Only an integer stages; a half-typed or emptied field is left
            // alone, because staging 0 mid-keystroke would silently propose a ceiling of nothing
            // that nobody chose.
            if (next === undefined || next === "") return;
            const parsed = Number(next);
            if (!Number.isInteger(parsed)) return;
            applyNext(parsed);
          }
        }
      />
    {:else}
      <Input id={controlId} bind:value={() => String(currentValue()), (next) => applyNext(next ?? "")} />
    {/if}

    <!-- One compact line under the control (owner-directed over a strikethrough): the
         superseded value rides a quiet badge — re-entered, never erased — with Revert beside
         it at the same small type. The line's space is PERMANENTLY reserved (the geometry
         invariant): it reveals by visibility, so staging never pushes the rows below —
         hidden it also leaves the tab order and the accessibility tree, which is the correct
         semantics for an action that only exists while staged. -->
    <div class="flex items-center gap-8 {staged ? '' : 'invisible'}">
      <Badge variant="neutral" class="tabular-nums">Was: {committedLabel()}</Badge>
      <Button variant="ghost" size="sm" class="text-xs" onclick={revert}>Revert</Button>
    </div>
  </div>
</div>
