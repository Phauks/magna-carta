<script lang="ts">
  /* Avatar.Fallback — initials (or any content) shown while the image loads or if it fails. Thin
     wrapper over Bits UI Avatar.Fallback. */
  import { Avatar as AvatarPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<AvatarPrimitive.FallbackProps> = $props();
</script>

<AvatarPrimitive.Fallback
  bind:ref
  class={mergeClasses("mc-avatar-fallback size-full", className)}
  {...restProps}
/>
