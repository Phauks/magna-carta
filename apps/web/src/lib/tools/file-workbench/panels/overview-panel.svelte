<script lang="ts">
  /*
   * Everything the workbench knows about one file, in one place.
   *
   * The Overview writes none of this itself. The file's own identity comes from the model, and
   * every other row is contributed by the capability that learned it (capabilities.ts,
   * summaryRowsFor). A capability added to the registry appears here without this file changing,
   * and one whose reading does not apply to this file contributes nothing rather than a blank row.
   */
  import Button from "@magna-carta/design-system/button";
  import FactTable, { type Fact } from "../parts/fact-table.svelte";
  import SectionHeading from "../parts/section-heading.svelte";
  import { CAPABILITIES, summaryRowsFor } from "../capabilities.ts";
  import { formatExactBytes, formatSize } from "../workbench-file.ts";
  import type { CapabilityPanelProps } from "../capability.ts";

  let { file, onOpenCapability }: CapabilityPanelProps = $props();

  const identity = $derived.by((): Fact[] => {
    const readable = formatSize(file.sizeBytes);
    const exact = formatExactBytes(file.sizeBytes);
    return [
      { label: "Name", value: file.name },
      // The exact count only rides along when it says something the readable figure does not. On a
      // small file the two are the same string, and printing it twice reads as a rendering fault.
      { label: "Size", value: readable, note: readable === exact ? undefined : exact },
    ];
  });

  const findings = $derived(
    summaryRowsFor(file).map(
      (row): Fact => ({ label: row.label, value: row.value, tone: row.tone }),
    ),
  );

  // What is left to ask for, on this file: the capabilities that wait to be asked and have
  // something to do here. Derived, so a new capability shows up without this list being edited.
  const offers = $derived(
    CAPABILITIES.filter(
      (capability) => capability.timing === "on-request" && capability.applies(file).applies,
    ),
  );
</script>

<div class="flex flex-col gap-24">
  <FactTable title="The File" facts={identity} />
  {#if findings.length > 0}
    <FactTable title="What Has Been Read" facts={findings} />
  {/if}

  {#if offers.length > 0}
    <div class="flex flex-col gap-8">
      <SectionHeading>What You Can Do</SectionHeading>
      <div class="flex flex-wrap gap-8">
        {#each offers as capability (capability.id)}
          {@const Icon = capability.icon}
          <Button
            variant="secondary"
            size="sm"
            onclick={() => onOpenCapability?.(capability)}
          >
            <Icon class="size-16" aria-hidden="true" />
            {capability.label}
          </Button>
        {/each}
      </div>
    </div>
  {/if}
</div>
