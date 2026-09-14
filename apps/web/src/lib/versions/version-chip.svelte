<script lang="ts">
  /*
   * The version chip — chrome, so it may carry identity quietly (the edges rule). The chip always
   * shows THIS build's own short commit, baked in at build time, so it renders whether or not the
   * API answers; opening it mounts the version report (version-report.svelte), which asks
   * GET /api/v1/meta/versions what every other part of the deployment is running and the
   * database-health route whether this firm's records can be reached.
   *
   * THE CHIP IS THE QUICK VIEW; THE VERSIONS PAGE IS THE FULL ONE. Both render the same report from
   * the same models (version-overlay-model.ts, database-health-model.ts), so the two can never
   * answer "what is running" differently — the page is the report at page size, not a second
   * implementation of it.
   *
   * THE CHIP SAYS WHICH BUILD MODE IT IS, outside production. Two screenshots of one commit, one
   * from a preview deploy and one from the real site, were indistinguishable, and a fault reported
   * against the wrong deployment costs a whole round of diagnosis. Production carries no badge:
   * that is the assumption a reader already holds.
   *
   * THE CHIP IS NOT THE ONLY WAY IN. Whether the panel is open lives in build-panel.svelte.ts
   * rather than here, so the command palette can open it through the diagnostic-action registry
   * ($lib/developer/diagnostic-actions.ts). The popover still binds to that state, so a dismiss by
   * Escape or click-away is the gesture it always was.
   *
   * THE CHIP NOTICES AN UPSTREAM DEPLOY. SvelteKit's version poll (svelte.config.js names each
   * build by its commit) compares the running bundle against what the deployment serving it is
   * publishing now; when a newer bundle is live the chip carries a warning dot and the report
   * offers the Reload control.
   *
   * NEITHER READ HAPPENS UNTIL THE PANEL IS OPENED. The chip is on every screen in the app, and a
   * standing health poll behind it would be a request on every page load to answer a question
   * nobody has asked yet; the report reads only while `open` is true.
   *
   * TWO SCOPES, ONE COMPONENT. Inside a session (`scope="app"`) the report covers the whole
   * deployment and its firm's database. On the signed-out surfaces (`scope="public"` — sign in,
   * password reset, the joining screens) it reports the page's own build only; the report keeps
   * that rule.
   */
  import * as Popover from "@magna-carta/design-system/popover";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import GitCommitHorizontal from "@lucide/svelte/icons/git-commit-horizontal";
  import { updated } from "$app/state";
  import { BUILD_IDENTITY } from "$lib/build-identity.ts";
  import VersionReport from "./version-report.svelte";
  import Badge from "@magna-carta/design-system/badge";
  import { buildPanel } from "$lib/versions/build-panel.svelte.ts";
  import {
    describeBuildEnvironment,
    versionChipLabel,
    type VersionScope,
  } from "$lib/versions/version-overlay-model.ts";

  let { scope = "app" }: { scope?: VersionScope } = $props();

  const chipLabel = versionChipLabel(BUILD_IDENTITY.commit);
  const buildEnvironment = describeBuildEnvironment(BUILD_IDENTITY.mode);

  // True once the version poll has seen a bundle newer than the one this tab is running.
  const updateAvailable = $derived(updated.current);
</script>

<Popover.Root bind:open={buildPanel.isOpen}>
  <!-- The hover names the control — "Build Information", the same one-name answer the bell, the
       Time Sheet's handle and the download tray give. The chip already shows the build; what the
       hover has to say is what pressing it opens. The tooltip and the popover share ONE button
       through the tooltip trigger's child snippet; the accessible name keeps the build itself,
       which a reader who cannot see the chip has no other way to hear. -->
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Popover.Trigger
          {...props}
          class="mc-top-bar-icon-button gap-8 border text-xs tabular-nums"
          style="border-color: var(--mc-chrome-border)"
          aria-label="Build Information: {chipLabel}{buildEnvironment === null
            ? ''
            : ` (${buildEnvironment.label})`}{updateAvailable ? ' (update available)' : ''}"
        >
          <GitCommitHorizontal class="size-16" aria-hidden="true" />
          <span class="font-mono">{chipLabel}</span>
          {#if buildEnvironment !== null}
            <!-- Outside production only: a badge that said "production" on every screen would be
                 chrome announcing the absence of news. -->
            <Badge variant={buildEnvironment.variant}>{buildEnvironment.label}</Badge>
          {/if}
          {#if updateAvailable}
            <!-- The quiet signal that a newer deployment is live; the panel carries the words. -->
            <span
              class="size-8 shrink-0 rounded-full"
              style="background-color: var(--mc-status-warning)"
              aria-hidden="true"
            ></span>
          {/if}
        </Popover.Trigger>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content>Build Information</Tooltip.Content>
  </Tooltip.Root>
  <!-- Sizing rides inline style, not a recipe: the max-height ceiling is the Bits-provided
       available viewport height (the same pattern the select listbox uses), so a short window
       scrolls the panel instead of clipping the service rows off-screen. -->
  <Popover.Content
    align="end"
    class="mc-scrollbar overflow-y-auto"
    style="inline-size: var(--mc-size-prose); max-height: var(--bits-floating-available-height)"
  >
    <VersionReport {scope} open={buildPanel.isOpen} />
  </Popover.Content>
</Popover.Root>
