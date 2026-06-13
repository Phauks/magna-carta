<script lang="ts">
  /*
   * Alert root — a status callout (Tier 1: native <div>, no Bits UI). Composes with AlertTitle
   * and AlertDescription. The ARIA role is derived from the variant (variants.ts): assertive
   * "alert" for danger/warning, polite "status" for info/success. Styling is the mc-alert recipe
   * (a solid status panel); mergeClasses is the class seam, WithElementRef the ref.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import { alertClasses, alertRole, type AlertVariant } from "./variants.ts";

  let {
    variant = "info",
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
    variant?: AlertVariant;
  } = $props();
</script>

<div
  bind:this={ref}
  role={alertRole(variant)}
  class={mergeClasses(alertClasses({ variant }), className)}
  {...restProps}
>
  {@render children?.()}
</div>
