<script lang="ts">
  /*
   * One of a payment method's details on a line: a check's bank, a card's last four, a money
   * order's issuer. The field is drawn by its shape (text, date, last four digits, a routing
   * number, a choice). An optional detail the person added carries an x to take it off again.
   * A refused detail shows a red edge with the reason on its hover, and no text under it.
   */
  import Button from "@magna-carta/design-system/button";
  import { DatePicker, civilDateTextOrEmpty, civilDateValue } from "@magna-carta/design-system/date-picker";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import X from "@lucide/svelte/icons/x";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import type { DetailField } from "./payment-methods.ts";

  let {
    field,
    id,
    value,
    refusal,
    disabled = false,
    onChange,
    onRemove,
  }: {
    field: DetailField;
    id: string;
    value: string;
    /** Why the value is refused, shown on hover; undefined when it stands. */
    refusal?: string | undefined;
    disabled?: boolean;
    onChange: (value: string) => void;
    /** Given for an optional detail: takes it off the line. */
    onRemove?: () => void;
  } = $props();

  const necessity = $derived(field.required ? ("required" as const) : undefined);
</script>

<div class="flex min-w-0 flex-col gap-4" title={refusal}>
    <div class="flex items-center justify-between gap-4">
      <Label for={id} {necessity}>{field.label}</Label>
      {#if onRemove !== undefined}
        <Button variant="ghost" size="icon-sm" class="-my-4" aria-label="Remove {field.label}" title="Remove" {disabled} onclick={onRemove}>
          <X class="size-16" aria-hidden="true" />
        </Button>
      {/if}
    </div>
    {#if field.shape.kind === "date"}
      <div class="grid">
        <DatePicker
          {id}
          aria-label={field.label}
          class="min-w-0"
          value={civilDateValue(value)}
          onValueChange={(next) => onChange(civilDateTextOrEmpty(next))}
          aria-invalid={refusal !== undefined}
          {disabled}
        />
      </div>
    {:else if field.shape.kind === "choice"}
      <ChoicePicker
        inputId={id}
        label={field.label}
        options={field.shape.choices.map((choice) => ({ value: choice, label: choice }))}
        {value}
        invalid={refusal !== undefined}
        title={refusal}
        {disabled}
        onchange={onChange}
      />
    {:else}
      <Input
        {id}
        {value}
        {disabled}
        autocomplete="off"
        inputmode={field.shape.kind === "text" ? undefined : "numeric"}
        maxlength={field.shape.kind === "lastFour" ? 4 : field.shape.kind === "routing" ? 9 : 200}
        aria-invalid={refusal !== undefined ? "true" : undefined}
        oninput={(event) => onChange(event.currentTarget.value)}
      />
    {/if}
</div>
