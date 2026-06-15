<script lang="ts">
  /* DropdownMenu.Portal — teleports its children to the body (or a given target) so the floating
     Content escapes overflow/stacking contexts. Thin pass-through over Bits UI DropdownMenu.Portal,
     with NO look of its own. Content portals itself by default, so a caller rarely reaches for this
     directly; it is exported for the rare case of a custom portal target. */
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";

  let { ...restProps }: DropdownMenuPrimitive.PortalProps = $props();
</script>

<DropdownMenuPrimitive.Portal {...restProps} />
