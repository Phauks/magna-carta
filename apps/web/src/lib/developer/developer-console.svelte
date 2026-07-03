<script lang="ts">
  /*
   * The developer console — the flask in the top bar (dev builds only, left of the profile
   * circle): controls the FIRM's users must never have, for fiddling with the running app while
   * designing it. A thin shell over the module registry (developer-console-registry.ts): every
   * module is one entry on the left rail (vertical tabs — the module list will keep growing, and
   * a left column stays scannable at ten modules where a top row would wrap). The rail renders
   * even with a single module, so the console visibly reads as modular and a future module never
   * piles into the same scroll. A module that must stay open during page interaction (layout
   * outlines, accessibility sweeps) is the trigger to trade this Popover for a right-edge Sheet —
   * the shell/module split exists so only this wrapper changes then.
   *
   * The shell mounts via an `import.meta.env.DEV`-gated dynamic import in the app shell, so none
   * of it reaches a production bundle.
   */
  import * as Popover from "@magna-carta/design-system/popover";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import FlaskConical from "@lucide/svelte/icons/flask-conical";
  import { DEVELOPER_CONSOLE_MODULES } from "./developer-console-registry.ts";

  let activeModuleId = $state(DEVELOPER_CONSOLE_MODULES[0]!.id);
</script>

<Popover.Root>
  <Popover.Trigger class="mc-top-bar-icon-button" aria-label="Developer console">
    <FlaskConical class="size-20" aria-hidden="true" />
  </Popover.Trigger>
  <Popover.Content
    align="end"
    class="flex flex-col gap-12 overflow-y-auto"
    style="inline-size: var(--mc-size-prose); max-block-size: var(--bits-popover-content-available-height)"
  >
    <div class="flex items-baseline justify-between gap-8">
      <p class="text-xs font-semibold text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
        Developer console
      </p>
      <p class="text-xs text-text-muted">Dev builds only · saved in this browser</p>
    </div>

    <!-- Vertical tabs: the recipe lays the rail beside the panel and moves the gilt indicator to
         the rail edge; the rail keeps its natural label width and the panel takes the rest. -->
    <Tabs.Root bind:value={activeModuleId} orientation="vertical">
      <Tabs.List class="shrink-0">
        {#each DEVELOPER_CONSOLE_MODULES as module (module.id)}
          <Tabs.Trigger value={module.id}>{module.title}</Tabs.Trigger>
        {/each}
      </Tabs.List>
      {#each DEVELOPER_CONSOLE_MODULES as module (module.id)}
        {@const ModuleComponent = module.component}
        <Tabs.Content value={module.id} class="min-w-0 grow">
          <ModuleComponent />
        </Tabs.Content>
      {/each}
    </Tabs.Root>
  </Popover.Content>
</Popover.Root>
