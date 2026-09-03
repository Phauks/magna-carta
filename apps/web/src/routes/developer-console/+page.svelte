<script lang="ts">
  import FieldLabel from "@magna-carta/design-system/field-label";
  /*
   * The popped-out developer console — the same module rail as the top-bar popover, rendered as
   * its own window so the main window stays clear. Deliberately OUTSIDE the (app) route group, so
   * it carries none of the app shell — just the console. Dev builds only: the panel is behind an
   * import.meta.env.DEV gate, so production serves only the unavailable notice (and the panel and
   * its modules tree-shake away).
   */
  import DeveloperConsolePanel from "$lib/developer/developer-console-panel.svelte";
</script>

<svelte:head>
  <title>Developer console · Magna Carta</title>
</svelte:head>

{#if import.meta.env.DEV}
  <div class="flex min-h-screen flex-col gap-12 bg-surface-default p-16 text-text-default">
    <div class="flex items-baseline justify-between gap-8">
      <FieldLabel as="p"
      >
        Developer console
      </FieldLabel>
      <p class="text-xs text-text-muted">Dev builds only · saved in this browser</p>
    </div>
    <DeveloperConsolePanel />
  </div>
{:else}
  <p class="p-16 text-sm text-text-muted">
    The developer console is only available in development builds.
  </p>
{/if}
