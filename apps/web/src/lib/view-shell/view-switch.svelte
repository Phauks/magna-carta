<script lang="ts" generics="Item, ViewId extends string, Context">
  /*
   * The view-switch control — a segmented group of icon buttons, one per registered view, the
   * active one held pressed. This is the generalized form of the Tools masthead toggle; the host
   * places it in its own chrome (this control renders no masthead of its own).
   *
   * It reads no context of its own, but stays generic over it so it can switch the views of any
   * shell — a host that hands capabilities to its views still gets the same switch.
   */
  import Button from "@magna-carta/design-system/button";
  import type { ViewShellController } from "./view-shell.svelte.ts";

  let {
    controller,
    label,
  }: { controller: ViewShellController<Item, ViewId, Context>; label: string } = $props();
</script>

<div class="flex items-center gap-4" role="group" aria-label={label}>
  {#each controller.views as view (view.id)}
    {@const Icon = view.icon}
    <Button
      variant={controller.activeViewId === view.id ? "secondary" : "ghost"}
      size="icon"
      aria-label={view.label}
      aria-pressed={controller.activeViewId === view.id}
      onclick={() => controller.setActiveView(view.id)}
    >
      <Icon class="size-16" aria-hidden="true" />
    </Button>
  {/each}
</div>
