<script lang="ts">
  /*
   * The model and effort a question is answered with, chosen in the composer.
   *
   * One control on the composer's row, reading the choice on its face ("Claude Opus 5.5, High"), so
   * the member sees what will answer without opening anything. The menu offers every model the firm
   * could choose on its AI settings screen and every effort level the chosen model takes: the roster
   * is the server's, so nothing here names a model.
   *
   * The firm's model, at its own default effort, is the starting point and is marked as the firm's.
   * Choosing another model keeps the effort when the new model takes it, and otherwise moves to that
   * model's default, so the control never shows an effort the model would refuse.
   */
  import { buttonClasses } from "@magna-carta/design-system/button";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import type { MagnusAnsweringModel, MagnusModelChoice } from "./magnus-api.ts";
  import { effortLabel, modelControlLabel } from "./magnus-vocabulary.ts";

  let {
    choice = $bindable(null),
    firmModel,
    models,
    disabled = false,
  }: {
    /** The member's choice, or null to be answered by the firm's model at its default effort. */
    choice?: MagnusModelChoice | null;
    firmModel: MagnusAnsweringModel;
    models: readonly MagnusAnsweringModel[];
    disabled?: boolean;
  } = $props();

  const shown = $derived(
    (choice === null ? undefined : models.find((model) => model.modelId === choice?.modelId)) ??
      firmModel,
  );
  const effort = $derived(choice?.effort ?? shown.defaultEffort);
  const label = $derived(modelControlLabel(shown, effort));

  function chooseModel(modelId: string): void {
    const next = models.find((model) => model.modelId === modelId);
    if (next === undefined) return;
    const kept = effort !== null && next.effortLevels.includes(effort) ? effort : next.defaultEffort;
    choice = { modelId: next.modelId, effort: kept };
  }

  function chooseEffort(level: string): void {
    choice = { modelId: shown.modelId, effort: level };
  }
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    class={buttonClasses({ variant: "ghost", size: "sm" })}
    aria-label="Model and effort: {label}"
    {disabled}
  >
    <Sparkles class="size-16" aria-hidden="true" />
    {label}
    <ChevronDown class="size-16" aria-hidden="true" />
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="start" style="min-inline-size: var(--mc-size-popover)">
    <DropdownMenu.RadioGroup value={shown.modelId} onValueChange={chooseModel}>
      <DropdownMenu.GroupHeading>Model</DropdownMenu.GroupHeading>
      {#each models as model (model.modelId)}
        <DropdownMenu.RadioItem value={model.modelId}>
          {model.displayName}
          {#if model.modelId === firmModel.modelId}
            <span class="text-text-muted">(Firm&rsquo;s Model)</span>
          {/if}
        </DropdownMenu.RadioItem>
      {/each}
    </DropdownMenu.RadioGroup>
    {#if shown.effortLevels.length > 0}
      <DropdownMenu.Separator />
      <DropdownMenu.RadioGroup value={effort ?? undefined} onValueChange={chooseEffort}>
        <DropdownMenu.GroupHeading>Effort</DropdownMenu.GroupHeading>
        {#each shown.effortLevels as level (level)}
          <DropdownMenu.RadioItem value={level}>
            {effortLabel(level)}
            {#if level === shown.defaultEffort}
              <span class="text-text-muted">(Default)</span>
            {/if}
          </DropdownMenu.RadioItem>
        {/each}
      </DropdownMenu.RadioGroup>
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>
