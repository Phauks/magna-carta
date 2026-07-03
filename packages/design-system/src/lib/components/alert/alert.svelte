<script lang="ts">
  /*
   * Alert root — a status callout (Tier 1: native <div>, no Bits UI). Composes with AlertTitle
   * and AlertDescription. The ARIA role is derived from the variant (variants.ts): assertive
   * "alert" for danger/warning, polite "status" for info/success. Styling is the mc-alert recipe
   * (the subtle status register: pale tint + same-hue hairline + leading glyph). The layout is a
   * two-column grid — a leading status icon, then the content column (title + description).
   *
   * The icon is derived from the variant (alertIcon) and is decorative (aria-hidden) — the role
   * and text carry the meaning. Pass an `icon` snippet to override the glyph; the default is the
   * variant's status glyph. mergeClasses is the class seam, WithElementRef the ref.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import type { Snippet } from "svelte";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import { alertClasses, alertRole, alertIcon, type AlertVariant } from "./variants.ts";

  let {
    variant = "info",
    ref = $bindable(null),
    class: className,
    icon,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
    /** Status the alert conveys; also sets the ARIA role (danger/warning announce assertively, info/success politely) and the leading glyph. */
    variant?: AlertVariant;
    /** Override the leading glyph; defaults to the variant's status icon. */
    icon?: Snippet;
  } = $props();
</script>

{#snippet defaultIcon()}
  {@const Icon = alertIcon(variant)}
  <Icon class="mc-alert-icon" aria-hidden="true" />
{/snippet}

<div
  bind:this={ref}
  role={alertRole(variant)}
  class={mergeClasses(alertClasses({ variant }), className)}
  {...restProps}
>
  {@render (icon ?? defaultIcon)()}
  <div class="mc-alert-content">
    {@render children?.()}
  </div>
</div>
