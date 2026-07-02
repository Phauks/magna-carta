<script lang="ts">
  /* AlertDialog.Portal — teleports the overlay + content out to the body (default) so they escape any
     ancestor overflow/stacking context. Renders no box of its own, so it takes no class. Thin
     wrapper over Bits UI AlertDialog.Portal. */
  import { AlertDialog as AlertDialogPrimitive } from "bits-ui";

  let { ...restProps }: AlertDialogPrimitive.PortalProps = $props();
</script>

<AlertDialogPrimitive.Portal {...restProps} />
