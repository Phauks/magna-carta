<script lang="ts">
  /*
   * Settings · Developer — controls over the development-only tooling itself. The master switch
   * pulls double duty: it is the kill switch (turning it off turns every subordinate flag off,
   * in the store) AND the reveal (while off, the subordinate rows are not rendered at all — a
   * disabled-switch graveyard invites toggling; an absent one reads as "enable to see more").
   * Everything lives in the developer-preferences store, so a flip takes effect everywhere
   * immediately and survives reload.
   */
  import Label from "@magna-carta/design-system/label";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import Switch from "@magna-carta/design-system/switch";
  import { developerPreferences } from "$lib/settings/developer-preferences.svelte.ts";
</script>

<svelte:head>
  <title>Developer · Settings · Magna Carta</title>
</svelte:head>

<Masthead.Root class="mb-24">
  <Masthead.Heading>
    <Masthead.Eyebrow>Settings</Masthead.Eyebrow>
    <Masthead.Title>Developer</Masthead.Title>
    <Masthead.Meta>
      <span>Controls that exist only in development builds.</span>
    </Masthead.Meta>
  </Masthead.Heading>
</Masthead.Root>

<div class="flex flex-col gap-24" style="max-inline-size: var(--mc-size-prose)">
  <div class="flex items-center justify-between gap-24">
    <div class="flex flex-col gap-4">
      <Label for="developer-settings-enabled">Enable developer settings</Label>
      <p class="text-sm text-text-muted">
        The master switch: turning it off turns every developer control off.
      </p>
    </div>
    <Switch
      id="developer-settings-enabled"
      bind:checked={
        () => developerPreferences.developerSettingsEnabled,
        (next) => {
          developerPreferences.developerSettingsEnabled = next;
        }
      }
    />
  </div>

  {#if developerPreferences.developerSettingsEnabled}
    <div class="flex items-center justify-between gap-24">
      <div class="flex flex-col gap-4">
        <Label for="developer-toolkit-in-header">Show developer toolkit in the header</Label>
        <p class="text-sm text-text-muted">
          Places the developer console in the top bar on every page.
        </p>
      </div>
      <Switch
        id="developer-toolkit-in-header"
        bind:checked={
          () => developerPreferences.developerToolkitInHeader,
          (next) => {
            developerPreferences.developerToolkitInHeader = next;
          }
        }
      />
    </div>
  {:else}
    <p class="text-sm text-text-muted">
      Enabling developer settings reveals the individual developer controls, all off until you
      turn them on.
    </p>
  {/if}
</div>
