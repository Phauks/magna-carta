<script lang="ts">
  /* Sheet.Root — owns the open state and pairs the Trigger with its Content; renders no DOM of its
     own. A Sheet is a Dialog that slides in from a screen edge (a drawer), so it is built on the
     SAME Bits UI Dialog primitives, not a separate component. Thin wrapper over Bits UI
     Dialog.Root. `open` is declared bindable and FORWARDED — a spread alone does not forward a
     two-way bind in Svelte 5, so a controlled sheet would silently fail without the `$bindable`. */
  import { Dialog as DialogPrimitive } from "bits-ui";

  let { open = $bindable(false), ...restProps }: DialogPrimitive.RootProps = $props();
</script>

<DialogPrimitive.Root bind:open {...restProps} />
