<script lang="ts">
  /*
   * Convert With Options: pick the format, then the settings that format takes, then convert.
   *
   * Shared by the File Workbench's Convert tab and the matter file manager's Convert flyout, so the
   * two places ask the same question in the same words. The dialog owns only the question. The
   * caller runs the conversion with what comes back, the same way a quick convert runs, and the
   * original is never touched.
   *
   * The settings shown are the ones the chosen format accepts from these files
   * (conversion-options.ts). A format that takes none says so, and still converts.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Label from "@magna-carta/design-system/label";
  import * as Select from "@magna-carta/design-system/select";
  import Slider from "@magna-carta/design-system/slider";
  import type { ConversionOptions } from "@magna-carta/conversion/options";
  import {
    DEFAULT_CHOICES,
    QUALITY_LIMITS,
    SIZE_ITEMS,
    optionsFromChoices,
    settingsFor,
    type ConvertDialogTarget,
  } from "./conversion-options.ts";

  let {
    open = $bindable(false),
    summary,
    targets,
    sources,
    onConfirm,
    onDismiss,
  }: {
    open?: boolean;
    /** What is being converted, as the reader would say it: a file name, or "3 files". */
    summary: string;
    targets: readonly ConvertDialogTarget[];
    /** The conversion graph's name for each file's format, so the settings fit every one. */
    sources: readonly string[];
    onConfirm: (targetId: string, options: ConversionOptions | undefined) => Promise<ActionOutcome>;
    onDismiss?: () => void;
  } = $props();

  /** The first target that takes a setting is the likeliest reason the dialog was opened. */
  function initialTarget(): string {
    return (
      targets.find((target) => settingsFor(sources, target.id).length > 0)?.id ?? targets[0]?.id ?? ""
    );
  }

  let targetId = $state("");
  let size = $state(DEFAULT_CHOICES.size);
  let quality = $state(DEFAULT_CHOICES.quality);
  let grayscale = $state(DEFAULT_CHOICES.grayscale);

  function reset(): void {
    targetId = initialTarget();
    size = DEFAULT_CHOICES.size;
    quality = DEFAULT_CHOICES.quality;
    grayscale = DEFAULT_CHOICES.grayscale;
  }

  const targetItems = $derived(targets.map((target) => ({ value: target.id, label: target.label })));
  const accepted = $derived(settingsFor(sources, targetId));
  const refusal = $derived(targetId === "" ? "Choose a format." : undefined);
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Convert with Options"
  subtitle={{ facts: [summary] }}
  commitLabel="Convert"
  commitBusyLabel="Starting"
  commitRefusal={refusal}
  unsavedChanges={false}
  onOpen={reset}
  onCommit={() => onConfirm(targetId, optionsFromChoices({ size, quality, grayscale }, accepted))}
  {onDismiss}
>
  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Label id="convert-options-target-label">Convert To</Label>
        <Select.Root
          type="single"
          items={targetItems}
          allowDeselect={false}
          disabled={busy}
          bind:value={targetId}
        >
          <Select.Trigger aria-labelledby="convert-options-target-label"><Select.Value /></Select.Trigger>
          <Select.Content>
            {#each targetItems as item (item.value)}
              <Select.Item value={item.value} label={item.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      {#if accepted.includes("maxDimension")}
        <div class="flex flex-col gap-8">
          <Label id="convert-options-size-label">Longest Side</Label>
          <Select.Root type="single" items={SIZE_ITEMS} allowDeselect={false} disabled={busy} bind:value={size}>
            <Select.Trigger aria-labelledby="convert-options-size-label"><Select.Value /></Select.Trigger>
            <Select.Content>
              {#each SIZE_ITEMS as item (item.value)}
                <Select.Item value={item.value} label={item.label} />
              {/each}
            </Select.Content>
          </Select.Root>
          <p class="text-xs text-text-muted">A smaller image keeps its size.</p>
        </div>
      {/if}

      {#if accepted.includes("quality")}
        <div class="flex flex-col gap-8">
          <Label>Quality: {quality}</Label>
          <Slider
            label="JPEG quality"
            min={QUALITY_LIMITS.minimum}
            max={QUALITY_LIMITS.maximum}
            step={1}
            disabled={busy}
            bind:value={quality}
          />
          <p class="text-xs text-text-muted">Lower makes a smaller file.</p>
        </div>
      {/if}

      {#if accepted.includes("grayscale")}
        <div class="flex items-center gap-8">
          <Checkbox id="convert-options-grayscale" bind:checked={grayscale} disabled={busy} />
          <Label for="convert-options-grayscale" class="font-normal">Grayscale</Label>
        </div>
      {/if}

      {#if targetId !== "" && accepted.length === 0}
        <p class="text-sm text-text-muted">This format has no settings to choose.</p>
      {/if}
    </div>
  {/snippet}
</ActionDialog>
