<script lang="ts">
  /* DropdownMenu.Root — owns the open state and pairs the Trigger with its Content; renders no DOM
     of its own. Thin wrapper over Bits UI DropdownMenu.Root. `open` is declared bindable and
     FORWARDED — a spread alone does not forward a two-way bind in Svelte 5, so a controlled menu
     would silently fail without the `$bindable`.

     Root also owns the hover activation (hover-open.ts): a mouse pointer resting on the Trigger
     opens the menu, which then follows the pointer between the Trigger, the Content, and any
     SubContent, and closes a beat after the pointer has left them all. On by default for every
     menu; `openOnHover={false}` keeps a menu click-only. Bits still owns every deliberate route
     (press, keyboard, touch), which hover adds to and never replaces.

     Root also joins the OVERLAY BAND it stands in, where it stands in one
     (../../internal/overlay-band.svelte.ts): in a strip of controls that share one open panel — the
     top bar — opening this menu closes whichever neighbour was open, deliberately, rather than
     hoping Bits' outside-press dismissal reaches it. Everywhere else the call finds no band and
     does nothing, so nothing outside such a strip changes. */
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import { joinOverlayBand } from "../../internal/overlay-band.svelte.ts";
  import { HoverOpenController, setHoverOpenContext } from "./hover-open.ts";

  let {
    open = $bindable(false),
    openOnHover = true,
    onOpenChange,
    ...restProps
  }: DropdownMenuPrimitive.RootProps & {
    /** Whether a mouse pointer resting on the Trigger opens the menu. */
    openOnHover?: boolean;
  } = $props();

  const hoverOpen = setHoverOpenContext(
    new HoverOpenController({
      enabled: () => openOnHover,
      isOpen: () => open,
      setOpen: (next) => {
        if (open === next) return;
        open = next;
        // Bits reports only the changes it makes itself; a hover open is ours to report.
        onOpenChange?.(next);
      },
    }),
  );

  joinOverlayBand(
    () => open,
    () => {
      if (!open) return;
      open = false;
      // Bits reports only the changes it makes itself; a close the band asked for is ours to report.
      onOpenChange?.(false);
    },
  );

  // Every change of `open`, whichever route made it, reaches the controller: a selection, Escape,
  // or a press outside closes the menu through Bits, and that has to end the hover episode too.
  $effect(() => {
    hoverOpen.openChanged(open);
  });

  $effect(() => () => hoverOpen.destroy());
</script>

<DropdownMenuPrimitive.Root bind:open {onOpenChange} {...restProps} />
