<script lang="ts">
  /*
   * How a draft set counts its exhibits. Numbering belongs to the set, not to a court: the starter
   * numberings are copied in as values and can then be changed, because two departments of one
   * courthouse can ask for different schemes. A prefix is optional, so it starts as an Add Prefix
   * button. What comes after Z is asked only for the two letter styles.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import * as Select from "@magna-carta/design-system/select";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import Plus from "@lucide/svelte/icons/plus";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    editExhibitSet,
    readSchemePresets,
    type ExhibitScheme,
    type ExhibitSetDetail,
  } from "./exhibits-api.ts";
  import {
    OVERFLOW_CHOICES,
    SEQUENCE_CHOICES,
    isLetterSequence,
    schemeSummary,
  } from "./exhibit-words.ts";

  let {
    open = $bindable(false),
    set,
    onChanged,
  }: {
    open?: boolean;
    set: ExhibitSetDetail;
    onChanged: () => void;
  } = $props();

  let noun = $state("");
  let prefix = $state("");
  let showPrefix = $state(false);
  let sequence = $state<ExhibitScheme["sequence"]>("upperLetter");
  let startAtText = $state("1");
  let overflowForm = $state<ExhibitScheme["overflowForm"]>("doubled");
  let presets = $state<readonly { key: string; name: string; scheme: ExhibitScheme }[]>([]);
  let failure = $state<StatedFailure | null>(null);

  function take(scheme: ExhibitScheme): void {
    noun = scheme.noun;
    prefix = scheme.prefix;
    showPrefix = scheme.prefix.length > 0;
    sequence = scheme.sequence;
    startAtText = String(scheme.startAt);
    overflowForm = scheme.overflowForm;
  }

  function reset(): void {
    take(set.scheme);
    failure = null;
    void readSchemePresets(fetch, set.matterId).then((outcome) => {
      presets = outcome.kind === "ok" ? outcome.value.presets : [];
    });
  }

  const startAt = $derived(Number.parseInt(startAtText, 10));
  const startAtValid = $derived(
    /^\d+$/.test(startAtText.trim()) && startAt >= 1 && startAt <= 100000,
  );
  const draft = $derived<ExhibitScheme>({
    noun: noun.trim(),
    prefix,
    sequence,
    startAt: startAtValid ? startAt : 1,
    overflowForm,
  });
  const unchanged = $derived(
    draft.noun === set.scheme.noun &&
      draft.prefix === set.scheme.prefix &&
      draft.sequence === set.scheme.sequence &&
      draft.startAt === set.scheme.startAt &&
      draft.overflowForm === set.scheme.overflowForm,
  );
  const refusal = $derived.by((): string | undefined => {
    if (!startAtValid) return "Start at a whole number from 1.";
    if (unchanged) return "The numbering is unchanged.";
    return undefined;
  });

  async function commit(): Promise<ActionOutcome> {
    failure = null;
    const outcome = await editExhibitSet(fetch, set.matterId, set.id, { scheme: draft });
    if (outcome.kind === "ok") {
      onChanged();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The numbering was not changed.",
      "Couldn't connect, so the set keeps its numbering.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Numbering"
  commitLabel="Save Numbering"
  commitBusyLabel="Saving"
  commitRefusal={refusal}
  width="narrow"
  unsavedChanges={!unchanged}
  onOpen={reset}
  onCommit={commit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Changed"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <p class="text-sm" aria-live="polite">{schemeSummary(draft)}</p>

      {#if presets.length > 0}
        <div class="flex flex-col gap-8">
          <Label id="exhibit-preset-label">Start From</Label>
          <div class="flex flex-wrap gap-8" role="group" aria-labelledby="exhibit-preset-label">
            {#each presets as preset (preset.key)}
              <Button variant="secondary" size="sm" disabled={busy} onclick={() => take(preset.scheme)}>
                {preset.name}
              </Button>
            {/each}
          </div>
        </div>
      {/if}

      <div class="flex flex-col gap-8">
        <Label id="exhibit-sequence-label">Style</Label>
        <Select.Root
          type="single"
          items={[...SEQUENCE_CHOICES]}
          disabled={busy}
          allowDeselect={false}
          bind:value={
            () => sequence,
            (picked) => (sequence = (picked as ExhibitScheme["sequence"]) || "upperLetter")
          }
        >
          <Select.Trigger aria-labelledby="exhibit-sequence-label">
            <Select.Value placeholder={placeholderOf("Style")} />
          </Select.Trigger>
          <Select.Content>
            {#each SEQUENCE_CHOICES as choice (choice.value)}
              <Select.Item value={choice.value} label={choice.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      <LabelledField label="Word">
        {#snippet children({ props })}
          <Input {...props} disabled={busy} bind:value={noun} placeholder={placeholderOf("Exhibit")} />
        {/snippet}
      </LabelledField>

      <LabelledField label="Start At">
        {#snippet children({ props })}
          <Input
            {...props}
            inputmode="numeric"
            disabled={busy}
            bind:value={startAtText}
            aria-invalid={!startAtValid}
          />
        {/snippet}
      </LabelledField>

      {#if showPrefix}
        <LabelledField label="Prefix">
          {#snippet children({ props })}
            <Input {...props} disabled={busy} bind:value={prefix} placeholder={placeholderOf("P-")} />
          {/snippet}
        </LabelledField>
      {:else}
        <div>
          <Button variant="ghost" size="sm" disabled={busy} onclick={() => (showPrefix = true)}>
            <Plus class="size-16" aria-hidden="true" />Add Prefix
          </Button>
        </div>
      {/if}

      {#if isLetterSequence(sequence)}
        <div class="flex flex-col gap-8">
          <Label id="exhibit-overflow-label">After Z</Label>
          <Select.Root
            type="single"
            items={[...OVERFLOW_CHOICES]}
            disabled={busy}
            allowDeselect={false}
            bind:value={
              () => overflowForm,
              (picked) => (overflowForm = (picked as ExhibitScheme["overflowForm"]) || "doubled")
            }
          >
            <Select.Trigger aria-labelledby="exhibit-overflow-label">
              <Select.Value placeholder={placeholderOf("After Z")} />
            </Select.Trigger>
            <Select.Content>
              {#each OVERFLOW_CHOICES as choice (choice.value)}
                <Select.Item value={choice.value} label={choice.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      {/if}
    </div>
  {/snippet}
</ActionDialog>
