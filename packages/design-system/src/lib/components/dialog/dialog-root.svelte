<script lang="ts">
  /* Dialog.Root — owns the open state and pairs the Trigger with its Content; renders no DOM of
     its own. Thin wrapper over Bits UI Dialog.Root. `open` is declared bindable and FORWARDED —
     a spread alone does not forward a two-way bind in Svelte 5, so without the explicit
     `$bindable` a controlled dialog (the Ctrl+K palette, any programmatic open) silently fails. */
  import { Dialog as DialogPrimitive } from "bits-ui";

  let { open = $bindable(false), ...restProps }: DialogPrimitive.RootProps = $props();
</script>

<DialogPrimitive.Root bind:open {...restProps} />
