<script lang="ts">
  /*
   * The assembly input area — a template version's fields laid out as a form, grouped by where
   * their values come from.
   *
   * The layout answers the two questions a person actually has, in order: what do I have to fill
   * in, and what happens by itself? So each group leads with its fields needing entry (the model
   * orders them) and the read-only context follows, and the header states the counts up front
   * rather than making someone scroll to find out how long this is.
   *
   * State lives here — one values map keyed by merge-field key — and validation is derived from it,
   * so there is exactly one source of truth for what has been typed and exactly one derivation of
   * what is wrong with it. Nothing is submitted from this component: it reports the values and the
   * validation summary upward, because whether an assembly may be started is a permission question,
   * not a form question.
   */
  import Button from "@magna-carta/design-system/button";
  import Badge from "@magna-carta/design-system/badge";
  import * as Card from "@magna-carta/design-system/card";
  import AssemblyInputFieldRow from "./assembly-input-field.svelte";
  import AssemblyValidationSummaryPanel from "./assembly-validation-summary.svelte";
  import {
    emptyAssemblyInputValues,
    validateAssemblyInput,
    type AssemblyInputPlan,
    type AssemblyValidationSummary,
  } from "./assembly-input-model.ts";

  let {
    plan,
    submitLabel = "Assemble document",
    onSubmit,
  }: {
    plan: AssemblyInputPlan;
    submitLabel?: string;
    /** Called only once validation passes. The caller decides what assembling actually means. */
    onSubmit?: (values: Record<string, string>, summary: AssemblyValidationSummary) => void;
  } = $props();

  // Seeded — and RE-seeded whenever the template changes — from the effect below rather than from
  // an initializer, so the values map is never keyed to a template that is no longer on screen:
  // a stale key would silently carry a value into a field that no longer exists.
  let values = $state<Record<string, string>>({});
  let attempted = $state(false);
  let lastPlanId = $state("");

  $effect(() => {
    if (plan.templateVersionId === lastPlanId) return;
    lastPlanId = plan.templateVersionId;
    values = emptyAssemblyInputValues(plan);
    attempted = false;
  });

  const summary = $derived(validateAssemblyInput(plan, values));
  const issueByKey = $derived(
    new Map(summary.issues.filter((issue) => issue.key !== null).map((issue) => [issue.key, issue])),
  );

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    attempted = true;
    if (!summary.ready) return;
    onSubmit?.({ ...values }, summary);
  }
</script>

<form class="flex flex-col gap-24" onsubmit={submit} novalidate>
  <header class="flex flex-col gap-8">
    <h2 class="text-xl font-semibold">{plan.templateName}</h2>
    <div class="flex flex-wrap items-center gap-8">
      <Badge variant={plan.entryFieldCount === 0 ? "success" : "warning"}>
        {plan.entryFieldCount === 1 ? "1 field to fill in" : `${plan.entryFieldCount} fields to fill in`}
      </Badge>
      <Badge variant="info">
        {plan.automaticFieldCount === 1
          ? "1 field fills itself"
          : `${plan.automaticFieldCount} fields fill themselves`}
      </Badge>
      {#if plan.unrecognizedKeys.length > 0}
        <Badge variant="danger">
          {plan.unrecognizedKeys.length === 1
            ? "1 placeholder is not a known field"
            : `${plan.unrecognizedKeys.length} placeholders are not known fields`}
        </Badge>
      {/if}
      {#if plan.protectedKeys.length > 0}
        <Badge variant="neutral">Uses a protected value</Badge>
      {/if}
    </div>
    {#if plan.protectedKeys.length > 0}
      <p class="text-sm text-text-muted">
        This template merges a protected value. Assembling it records an audited read, and needs
        permission to view sensitive identifiers.
      </p>
    {/if}
  </header>

  <AssemblyValidationSummaryPanel {summary} {attempted} />

  {#each plan.groups as group (group.group)}
    <Card.Root>
      <Card.Header>
        <Card.Title>{group.label}</Card.Title>
        <Card.Description>
          {group.fields.filter((field) => field.requiresEntry).length === 0
            ? "Nothing to fill in. Every field in this group fills itself."
            : "The fields with a control are the ones needing a value from you."}
        </Card.Description>
      </Card.Header>
      <Card.Content>
        <div class="flex flex-col gap-20">
          {#each group.fields as field (field.key)}
            <AssemblyInputFieldRow
              {field}
              bind:value={
                () => values[field.key] ?? "", (next) => (values = { ...values, [field.key]: next })
              }
              issue={issueByKey.get(field.key) ?? null}
            />
          {/each}
        </div>
      </Card.Content>
    </Card.Root>
  {/each}

  <div class="flex items-center gap-16">
    <Button type="submit">{submitLabel}</Button>
    <span class="text-sm text-text-muted">
      Nothing is assembled or filed until you choose this.
    </span>
  </div>
</form>
