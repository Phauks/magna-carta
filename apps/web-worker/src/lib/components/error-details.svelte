<script lang="ts">
  /*
   * The copyable diagnostics block on error surfaces (owner review 2026-07-02): everything a
   * report needs — time, status, path, message, the Error ID when the telemetry pipeline
   * supplies one — as selectable monospace text plus a one-click Copy. `select-all` makes a
   * single click take the whole block even without the button.
   */
  import { page } from "$app/state";
  import Button from "@magna-carta/design-system/button";
  import Copy from "@lucide/svelte/icons/copy";
  import Check from "@lucide/svelte/icons/check";
  import { buildIdentityLine } from "$lib/build-identity.ts";

  const errorId = $derived(
    (page.error as { errorId?: string } | null)?.errorId ?? "not yet assigned",
  );
  // Trace-shaped: every line a `key: value` pair, build identity included, so one paste tells
  // support WHICH build misbehaved and where (owner review 2026-07-02 — version tracing).
  const details = $derived(
    [
      "Magna Carta — error report",
      `build: ${buildIdentityLine()}`,
      `time: ${new Date().toISOString()}`,
      `status: ${page.status}`,
      `path: ${page.url.pathname}${page.url.search}`,
      `message: ${page.error?.message ?? "(none)"}`,
      `error id: ${errorId}`,
      `browser: ${navigator.userAgent}`,
    ].join("\n"),
  );

  let copied = $state(false);

  async function copyDetails(): Promise<void> {
    await navigator.clipboard.writeText(details);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<div class="mt-16 flex flex-col items-stretch gap-8" style="max-inline-size: var(--mc-size-prose)">
  <pre
    class="rounded-md border border-border-default bg-surface-sunken p-12 text-start font-mono text-xs whitespace-pre-wrap text-text-muted select-all">{details}</pre>
  <div class="flex justify-end">
    <Button variant="secondary" size="sm" onclick={copyDetails}>
      {#if copied}
        <Check class="size-16" aria-hidden="true" />
        Copied
      {:else}
        <Copy class="size-16" aria-hidden="true" />
        Copy details
      {/if}
    </Button>
  </div>
</div>
