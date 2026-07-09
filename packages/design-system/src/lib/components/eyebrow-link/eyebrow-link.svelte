<script lang="ts">
  /*
   * EyebrowLink — a masthead eyebrow rendered as an anchor: a letterspaced small-caps LABEL that
   * navigates. It is not a control, so it carries no control height; the box hugs its ink and the
   * ink sits flush with the block-start edge (recipe in eyebrow-link.css). The consumer supplies
   * the leading icon and the label as children, so the component stays a pure register + anchor —
   * it prescribes no icon and no text. mergeClasses is the single class seam (a consumer `class`
   * wins last); the anchor rest props (aria-label, rel, target, download, ...) forward through.
   * WithElementRef adds the bindable `ref`. `href` is declared explicitly (with JSDoc) so docgen
   * lists it under the catalog's Properties group rather than leaving it in the attribute spread.
   */
  import type { HTMLAnchorAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    href,
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAnchorAttributes, HTMLAnchorElement> & {
    /** A destination URL for the link. */
    href?: string;
  } = $props();
</script>

<a bind:this={ref} {href} class={mergeClasses("mc-eyebrow-link", className)} {...restProps}>
  {@render children?.()}
</a>
