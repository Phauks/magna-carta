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
  import { buttonClasses } from "@magna-carta/design-system/button";
  import * as Popover from "@magna-carta/design-system/popover";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import FlaskConical from "@lucide/svelte/icons/flask-conical";
  import SquareArrowOutUpRight from "@lucide/svelte/icons/square-arrow-out-up-right";
  import DeveloperConsolePanel from "./developer-console-panel.svelte";

  let open = $state(false);

  // Pop the console out into its own window so the main window is left clear. It renders the same
  // module rail at a dedicated dev route; opening it closes this popover. Named, so a second
  // pop-out reuses the one window rather than stacking.
  function popOut(): void {
    window.open("/developer-console", "mc-developer-console", "popup,width=480,height=780");
    open = false;
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger class="mc-top-bar-icon-button" aria-label="Developer console">
    <FlaskConical class="size-20" aria-hidden="true" />
  </Popover.Trigger>
  <Popover.Content
    align="end"
    class="mc-scrollbar flex flex-col gap-12 overflow-y-auto"
    style="inline-size: var(--mc-size-prose); max-block-size: var(--bits-popover-content-available-height)"
  >
    <div class="flex items-baseline justify-between gap-8">
      <p class="text-xs font-semibold text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
        Developer console
      </p>
      <div class="flex items-center gap-8">
        <p class="text-xs text-text-muted">Dev builds only · saved in this browser</p>
        <Tooltip.Root>
          <Tooltip.Trigger
            class={buttonClasses({ variant: "ghost", size: "icon" })}
            onclick={popOut}
            aria-label="Open developer console in a new window"
          >
            <SquareArrowOutUpRight class="size-16" aria-hidden="true" />
          </Tooltip.Trigger>
          <Tooltip.Content side="bottom">Open in a new window</Tooltip.Content>
        </Tooltip.Root>
      </div>
    </div>

    <DeveloperConsolePanel />
  </Popover.Content>
</Popover.Root>
