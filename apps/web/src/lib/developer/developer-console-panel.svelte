<script lang="ts">
  /*
   * The developer console's inner panel — the vertical module tabs, shared by the top-bar popover
   * (developer-console.svelte) and the popped-out window (routes/developer-console). The shell
   * around it differs (a floating popover vs. a whole window); the module rail is identical, so it
   * lives here once.
   */
  import * as Tabs from "@magna-carta/design-system/tabs";
  import { DEVELOPER_CONSOLE_MODULES } from "./developer-console-registry.ts";

  let activeModuleId = $state(DEVELOPER_CONSOLE_MODULES[0]!.id);
</script>

<!-- Vertical tabs: the recipe lays the rail beside the panel and moves the gilt indicator to the
     rail edge; the rail keeps its natural label width and the panel takes the rest. -->
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
