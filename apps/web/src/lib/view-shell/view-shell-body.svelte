<script lang="ts" generics="Item, ViewId extends string, Context">
  /*
   * The shell body — it renders the active view and nothing else (no masthead, no title): the host
   * owns the chrome above. Swapping views remounts the component so a view keeps no stale state
   * from the one before it; the shared selection and the host's context live on the controller and
   * outlive the swap.
   */
  import type { ViewShellController } from "./view-shell.svelte.ts";

  let { controller }: { controller: ViewShellController<Item, ViewId, Context> } = $props();

  const active = $derived(controller.activeView);
</script>

{#key active.id}
  {@const View = active.view}
  <View items={controller.items} selection={controller.selection} context={controller.context} />
{/key}
