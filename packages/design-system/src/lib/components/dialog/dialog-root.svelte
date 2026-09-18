<script lang="ts">
  /* Dialog.Root — owns the open state and pairs the Trigger with its Content; renders no DOM of
     its own. Thin wrapper over Bits UI Dialog.Root. `open` is declared bindable and FORWARDED —
     a spread alone does not forward a two-way bind in Svelte 5, so without the explicit
     `$bindable` a controlled dialog (the Ctrl+K palette, any programmatic open) silently fails. */
  import { Dialog as DialogPrimitive } from "bits-ui";

  import { joinOverlayBand } from "../../internal/overlay-band.svelte.ts";

  let { open = $bindable(false), onOpenChange, ...restProps }: DialogPrimitive.RootProps = $props();

  // A dialog raised from a control seated in an overlay band — the Time Sheet from its top-bar
  // chip — takes the band's one open place like a popover would, so the tray beside it goes as
  // the sheet arrives rather than floating over it. Everywhere else the call finds no band.
  joinOverlayBand(
    () => open,
    () => {
      if (!open) return;
      open = false;
      onOpenChange?.(false);
    },
  );
</script>

<DialogPrimitive.Root bind:open {onOpenChange} {...restProps} />
