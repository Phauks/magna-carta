<script lang="ts">
  /* ContextMenu.Portal — teleports its children to the body (or a given target) so the floating
     Content escapes overflow/stacking contexts. Thin pass-through over Bits UI ContextMenu.Portal,
     with NO look of its own. Content portals itself by default, so a caller rarely reaches for this
     directly; it is exported for the rare case of a custom portal target. */
  import { ContextMenu as ContextMenuPrimitive } from "bits-ui";

  let { ...restProps }: ContextMenuPrimitive.PortalProps = $props();
</script>

<ContextMenuPrimitive.Portal {...restProps} />
