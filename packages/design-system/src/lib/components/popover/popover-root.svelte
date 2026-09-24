<script lang="ts">
  /* Popover.Root — owns the open state and pairs the Trigger with its Content; renders no DOM of
     its own. Thin wrapper over Bits UI Popover.Root. `open` is declared bindable and FORWARDED —
     a spread alone does not forward a two-way bind in Svelte 5, so a controlled popover would
     silently fail without the `$bindable`.

     Root also joins the OVERLAY BAND it stands in, where it stands in one
     (internal/overlay-band.svelte.ts): in a strip of controls that share one open panel — the top
     bar — opening this popover closes whichever neighbour was open, deliberately, rather than
     hoping Bits' outside-press dismissal reaches it. Everywhere else the call finds no band and
     does nothing, so nothing outside such a strip changes. */
  import { Popover as PopoverPrimitive } from "bits-ui";
  import { joinOverlayBand } from "../../internal/overlay-band.svelte.ts";

  let { open = $bindable(false), onOpenChange, ...restProps }: PopoverPrimitive.RootProps = $props();

  joinOverlayBand(
    () => open,
    () => {
      if (!open) return;
      open = false;
      // Bits reports only the changes it makes itself; a close the band asked for is ours to report.
      onOpenChange?.(false);
    },
  );
</script>

<PopoverPrimitive.Root bind:open {onOpenChange} {...restProps} />
