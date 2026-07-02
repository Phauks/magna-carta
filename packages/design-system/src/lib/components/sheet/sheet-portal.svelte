<script lang="ts">
  /* Sheet.Portal — teleports the overlay + content out to the body (default) so they escape any
     ancestor overflow/stacking context. Renders no box of its own, so it takes no class. Thin
     wrapper over Bits UI Dialog.Portal. */
  import { Dialog as DialogPrimitive } from "bits-ui";

  let { ...restProps }: DialogPrimitive.PortalProps = $props();
</script>

<DialogPrimitive.Portal {...restProps} />
