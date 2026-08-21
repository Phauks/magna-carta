<script lang="ts">
  /*
   * The `…` overflow menu for the two run preferences — low internet usage mode and auto-start.
   * Follows the overflow-menu precedent in matter-header.svelte: a bordered ghost icon button opens
   * a portaled DropdownMenu.Content holding toggleable rows.
   *
   * Disabled while a run is in progress (`running` or `paused`): the ladder is fixed at engine
   * construction (see speed-test-engine.svelte.ts), so flipping low-data mode mid-run could not
   * change the run already under way — it would only silently mismatch the results already on
   * screen against a preference that no longer describes them.
   */
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";

  let {
    lowData,
    autoStart,
    disabled,
    canDownloadReport,
    onLowDataChange,
    onAutoStartChange,
    onDownloadReport,
  }: {
    lowData: boolean;
    autoStart: boolean;
    disabled: boolean;
    canDownloadReport: boolean;
    onLowDataChange: (value: boolean) => void;
    onAutoStartChange: (value: boolean) => void;
    onDownloadReport: () => void;
  } = $props();
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    {disabled}
    class="{buttonClasses({ variant: 'ghost', size: 'icon' })} border border-border-default"
    aria-label="Test options"
  >
    <Ellipsis class="size-16" aria-hidden="true" />
  </DropdownMenu.Trigger>
  <!-- Fixed at the popover width: a menu hanging off a small icon should be a compact column, not a
       panel stretched across the page. The helper text is kept to a short line so the fixed width
       does not force it tall; the full low-data caveat lives in the page footer. -->
  <DropdownMenu.Content
    align="end"
    style="inline-size: var(--mc-size-popover)"
  >
    <DropdownMenu.CheckboxItem
      checked={lowData}
      onCheckedChange={(value) => onLowDataChange(value)}
    >
      <div class="grid gap-4 py-4">
        <span>Low internet usage</span>
        <span class="text-xs text-text-muted">
          About 16 MB, not 200. Reads a fast line slower than it is.
        </span>
      </div>
    </DropdownMenu.CheckboxItem>
    <DropdownMenu.CheckboxItem
      checked={autoStart}
      onCheckedChange={(value) => onAutoStartChange(value)}
    >
      <div class="grid gap-4 py-4">
        <span>Start automatically</span>
        <span class="text-xs text-text-muted">Runs as soon as the page opens.</span>
      </div>
    </DropdownMenu.CheckboxItem>
    <!--
      The report is gated on a FINISHED run (canDownloadReport), independently of the run-in-progress
      `disabled` above: there is nothing to write down until a run completes, and the preferences are
      frozen for a different reason (the ladder is fixed at engine construction).
    -->
    <DropdownMenu.Separator />
    <DropdownMenu.Item disabled={!canDownloadReport} onSelect={onDownloadReport}>
      Download report
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
