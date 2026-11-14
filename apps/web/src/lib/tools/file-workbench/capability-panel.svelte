<script lang="ts">
  /*
   * One capability's findings for the file in focus.
   *
   * Three cases, in this order, and the order matters. A capability with nothing to do on this file
   * says so first, because its panel would otherwise render a form for work that cannot happen. A
   * capability with a panel renders it. A capability without one gets the standard not-yet-served
   * treatment, which is why seven of them need no component of their own. The panel comes from the
   * map in capability-panels.ts rather than off the module, so the modules stay DOM-free.
   *
   * Note what is NOT here: nothing consults the malware verdict. A file that failed a scan is
   * marked and still gets every capability, because a file somebody does not trust is exactly what
   * this workbench is for and taking the readings away is what would leave them guessing.
   */
  import PendingCapability from "./parts/pending-capability.svelte";
  import Absence from "./parts/absence.svelte";
  import { panelFor } from "./capability-panels.ts";
  import type { CapabilityModule } from "./capability.ts";
  import type { WorkbenchFile } from "./workbench-file.ts";

  let {
    capability,
    file,
    files,
    onOpenCapability,
    onAddFiles,
  }: {
    capability: CapabilityModule;
    file: WorkbenchFile;
    /** The whole selection for a `selection`-scoped capability; the file in focus otherwise. */
    files: readonly WorkbenchFile[];
    onOpenCapability?: (capability: CapabilityModule) => void;
    onAddFiles?: (files: readonly File[]) => void;
  } = $props();

  const applicability = $derived(capability.applies(file));
  const Panel = $derived(panelFor(capability.id));
</script>

{#if !applicability.applies}
  <Absence kind="not-applicable" reason={applicability.reason} />
{:else if Panel}
  <Panel {file} {files} {onOpenCapability} {onAddFiles} />
{:else}
  <PendingCapability
    action={capability.pendingAction}
    awaiting={capability.awaiting ?? "this tool"}
  />
{/if}
