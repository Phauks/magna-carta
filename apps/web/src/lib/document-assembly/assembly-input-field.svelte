<script lang="ts">
  /*
   * One field in the assembly input area.
   *
   * The component's job is the distinction that makes the whole surface worth having: a field that
   * FILLS ITSELF is shown as context — its chip, where the value comes from, and an example of how
   * it will render — and gets no input at all, because offering an empty box for something the firm
   * already knows invites someone to retype it wrong. A field that needs a person gets a control
   * typed to its value, and says in one line why it is being asked for.
   *
   * The control per value type is a lookup, not a chain of special cases, so adding a type is one
   * branch here plus the type in the catalog contract. Money is the one deliberate interim: it takes
   * a decimal-shaped text field until the dedicated money control (bound to @magna-carta/money and
   * its minor-unit arithmetic) is built, and the model's validation only checks the SHAPE of what
   * was typed — no arithmetic happens anywhere on this path.
   */
  import { parseDate, type DateValue } from "@internationalized/date";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import MergeFieldChip from "@magna-carta/design-system/merge-field-chip";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import type { AssemblyInputField, AssemblyValidationIssue } from "./assembly-input-model.ts";
  import { chipStatusForAvailability } from "./catalog-adapters.ts";

  let {
    field,
    value = $bindable(""),
    issue = null,
  }: {
    field: AssemblyInputField;
    /** The text this field holds. Bindable — the input area owns the values map. */
    value?: string;
    /** The one issue the validation summary raised about this field, when it raised one. */
    issue?: AssemblyValidationIssue | null;
  } = $props();

  const scope = $props.id();
  const controlId = `${scope}-control`;
  const noteId = `${scope}-note`;
  const issueId = `${scope}-issue`;
  const describedBy = $derived(issue ? `${noteId} ${issueId}` : noteId);
  const invalid = $derived(issue?.severity === "error");
  const chipStatus = $derived(chipStatusForAvailability(field.disposition));

  /** The stored ISO text as a calendar date, or undefined while it is empty or half-typed. */
  const calendarValue = $derived.by(() => {
    if (value === "") return undefined;
    try {
      return parseDate(value);
    } catch {
      return undefined;
    }
  });

  /*
   * The picker hands back the general DateValue union; a civil date is what a document renders, and
   * its ISO string is what the form holds. `toString()` is the same ISO form for every member of the
   * union, so no narrowing is needed to store it.
   */
  function recordDate(next: DateValue | undefined): void {
    value = next ? next.toString() : "";
  }
</script>

{#if field.requiresEntry}
  <div class="flex flex-col gap-4">
    {#if field.valueType !== "date"}
      <!-- The date control renders its own label (its segmented parts need it wired their way). -->
      <Label for={controlId}>
        {field.label}
        {#if !field.required}
          <span class="font-regular text-text-muted">(optional)</span>
        {/if}
      </Label>
    {/if}

    {#if field.valueType === "date"}
      <!-- DatePicker holds a calendar date; the form's state stays ISO text (see the model). -->
      <DatePicker label={field.label} value={calendarValue} onValueChange={recordDate} />
    {:else if field.valueType === "boolean"}
      <RadioGroup.Root
        bind:value
        aria-label={field.label}
        aria-describedby={describedBy}
        class="flex flex-row gap-16"
      >
        <div class="flex items-center gap-8">
          <RadioGroup.Item value="yes" id={controlId} aria-label={`${field.label}: yes`} />
          <span class="text-sm">Yes</span>
        </div>
        <div class="flex items-center gap-8">
          <RadioGroup.Item value="no" aria-label={`${field.label}: no`} />
          <span class="text-sm">No</span>
        </div>
      </RadioGroup.Root>
      <!-- A multi-line control returns with the structured `address` value type, the one merge value
           that genuinely renders as several lines. The two types that used to select a textarea here,
           `longText` and `address`, were the contract's own inventions — no field the engine ships ever
           carried either, so nothing ever reached this branch. -->
    {:else if field.valueType === "money"}
      <Input
        id={controlId}
        type="text"
        inputmode="decimal"
        bind:value
        placeholder="0.00"
        aria-describedby={describedBy}
        aria-invalid={invalid ? "true" : undefined}
      />
    {:else if field.valueType === "number"}
      <Input
        id={controlId}
        type="number"
        bind:value
        aria-describedby={describedBy}
        aria-invalid={invalid ? "true" : undefined}
      />
    {:else}
      <Input
        id={controlId}
        type="text"
        bind:value
        aria-describedby={describedBy}
        aria-invalid={invalid ? "true" : undefined}
      />
    {/if}

    <p id={noteId} class="text-xs text-text-muted">{field.availabilityNote}</p>
    {#if issue}
      <p
        id={issueId}
        class={issue.severity === "error"
          ? "text-xs text-status-danger-subtle-foreground"
          : "text-xs text-status-warning-subtle-foreground"}
      >
        {issue.message}
      </p>
    {/if}
  </div>
{:else}
  <!-- Context, not an input: this field fills itself, or nothing can fill it. -->
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center gap-8">
      <MergeFieldChip
        label={field.label}
        valueTypeLabel={field.valueTypeLabel}
        status={chipStatus}
      />
      {#if field.occurrences > 1}
        <span class="text-xs text-text-muted">Appears {field.occurrences} times</span>
      {/if}
    </div>
    <p class="text-xs text-text-muted">{field.availabilityNote}</p>
    {#if field.exampleRendering !== ""}
      <p class="text-xs text-text-subtle">Renders as: {field.exampleRendering}</p>
    {/if}
  </div>
{/if}
