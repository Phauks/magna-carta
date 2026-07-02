<script lang="ts">
  /* Sheet.Root — owns the open state and pairs the Trigger with its Content; renders no DOM of its
     own. A Sheet is a Dialog that slides in from a screen edge (a drawer), so it is built on the
     SAME Bits UI Dialog primitives, not a separate component. Thin wrapper over Bits UI
     Dialog.Root. `open` is bindable. */
  import { Dialog as DialogPrimitive } from "bits-ui";

  let { ...restProps }: DialogPrimitive.RootProps = $props();
</script>

<DialogPrimitive.Root {...restProps} />
