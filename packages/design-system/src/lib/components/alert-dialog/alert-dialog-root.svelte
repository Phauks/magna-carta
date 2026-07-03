<script lang="ts">
  /* AlertDialog.Root — owns the open state and pairs the Trigger with its Content; renders no DOM of
     its own. Thin wrapper over Bits UI AlertDialog.Root. `open` is declared bindable and forwarded so
     a caller can drive it (`bind:open`) — needed because the Action does NOT self-close: it is where
     the caller runs the confirm work and then lowers `open`. An alert dialog is a decision dialog:
     the user confirms or cancels, so there is no incidental dismiss. */
  import { AlertDialog as AlertDialogPrimitive } from "bits-ui";

  let { open = $bindable(false), ...restProps }: AlertDialogPrimitive.RootProps = $props();
</script>

<AlertDialogPrimitive.Root bind:open {...restProps} />
