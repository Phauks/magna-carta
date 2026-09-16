<script lang="ts">
  /*
   * The top-bar transfer tray — one frame, rendered twice: once for Uploads, once for Downloads.
   *
   * The two trays had been built separately and had drifted apart in the ways separate things do.
   * Downloads named itself on hover and Uploads did not, so the one control in that band a member
   * could not identify was the one that starts a transfer. Each had its own empty wording and its
   * own paragraph under it. The frame is genuinely one frame — an icon that carries a dot when
   * there is something to say, a titled panel, a list, and the way to the full surface — so it is
   * one component, and what differs between the two registers is passed in.
   *
   * THE TOOLTIP AND THE POPOVER SHARE ONE BUTTON, through the tooltip trigger's child snippet. Two
   * elements would be two controls, and the hover would name a thing beside the thing it names.
   *
   * THE DOT IS HONEST STATE. `marked` means this register has something to say right now — bytes
   * moving, a failure not yet cleared, something that arrived since the tray was last opened — and
   * while it is raised it takes the one 16px corner from the maturity dot, because a live transfer
   * is more time-sensitive than a build stage. The stage stays stated on the sidebar row.
   */
  import type { Component, Snippet } from "svelte";
  import * as Popover from "@magna-carta/design-system/popover";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import { MaturityDot } from "@magna-carta/design-system/maturity";
  import {
    DESTINATIONS,
    destinationStage,
    type Destination,
  } from "$lib/navigation/destinations.ts";

  let {
    /** The register's name — the hover, the panel's title, and the footer link all read it. */
    label,
    icon: Icon,
    /** The full surface this tray opens into. */
    href,
    /** The destination registry id this tray is the top-bar entry to, for the maturity dot. */
    destinationId,
    marked = false,
    /** What the raised dot means, for a reader who cannot see it. */
    markedLabel,
    open = $bindable(false),
    headerActions,
    children,
  }: {
    label: string;
    icon: Component;
    href: string;
    destinationId: string;
    marked?: boolean;
    markedLabel?: string;
    open?: boolean;
    /** Controls that belong beside the panel's title (Clear Finished, and the like). */
    headerActions?: Snippet;
    /** The panel's body. `close` is handed in so a row that navigates can shut the tray. */
    children: Snippet<[{ close: () => void }]>;
  } = $props();

  const destination = DESTINATIONS.find(
    (candidate) => candidate.id === destinationId,
  ) as Destination;

  function close(): void {
    open = false;
  }
</script>

<Popover.Root bind:open>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Popover.Trigger {...props} class="mc-top-bar-icon-button relative" aria-label={label}>
          <Icon class="size-16" aria-hidden="true" />
          {#if marked}
            <span
              class="absolute end-4 top-4 block size-8 rounded-full"
              style="background: var(--mc-accent-default)"
              aria-hidden="true"
            ></span>
            <span class="sr-only">{markedLabel ?? label}</span>
          {:else}
            <MaturityDot stage={destinationStage(destination)} class="absolute end-4 top-4" />
          {/if}
        </Popover.Trigger>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content>{label}</Tooltip.Content>
  </Tooltip.Root>
  <Popover.Content
    align="end"
    class="flex flex-col gap-8"
    style="inline-size: var(--mc-size-popover)"
  >
    <div class="flex items-center gap-8">
      <p class="text-sm font-medium">{label}</p>
      {#if headerActions}
        <div class="ms-auto flex items-center gap-4">{@render headerActions()}</div>
      {/if}
    </div>
    {@render children({ close })}
    <a
      {href}
      class="text-sm font-medium"
      style="color: var(--mc-accent-default)"
      onclick={close}
    >
      Open {label.toLowerCase()}
    </a>
  </Popover.Content>
</Popover.Root>
