<script lang="ts">
  /* Dialog.Root — owns the open state and pairs the Trigger with its Content; renders no DOM of
     its own. Thin wrapper over Bits UI Dialog.Root. `open` is bindable. */
  import { Dialog as DialogPrimitive } from "bits-ui";

  let { ...restProps }: DialogPrimitive.RootProps = $props();
</script>

<DialogPrimitive.Root {...restProps} />
