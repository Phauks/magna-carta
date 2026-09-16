<script lang="ts">
  /*
   * The GitHub mark — a third-party brand mark, not one of our icons.
   *
   * WHY THIS IS NOT A LUCIDE ICON. Every glyph in this product is Lucide and we draw none of our
   * own (docs/conventions/file-manager-rulings.md, ruling I15). A service's own mark is the one
   * thing that rule cannot cover: it is not a glyph for an idea, it is the identity of a specific
   * outside service, and the nearest Lucide shape for it is a lie about which service a control
   * opens. A git-branch glyph on the control that opens the source repository said "a branch",
   * which is not what is on the other side of that link.
   *
   * SO IT FOLLOWS THE BRAND-ASSET TRACK INSTEAD (docs/conventions/third-party-trademarks.md): the
   * path is GitHub's own published mark, self-hosted here and unaltered — never hotlinked, which
   * would leak who is looking at what — and shown solely to identify the service a link goes to.
   * It takes `currentColor` so it reads as the single-colour mark in whatever ink surrounds it,
   * which is the monochrome use GitHub's own guidance provides for; nothing else about the
   * geometry is touched.
   */
  import type { SVGAttributes } from "svelte/elements";

  let { class: className, ...restProps }: SVGAttributes<SVGSVGElement> = $props();
</script>

<svg
  viewBox="0 0 32 32"
  fill="currentColor"
  xmlns="http://www.w3.org/2000/svg"
  class={className}
  aria-hidden="true"
  {...restProps}
>
  <path
    fill-rule="evenodd"
    clip-rule="evenodd"
    d="M16 0C7.16 0 0 7.16 0 16C0 23.08 4.58 29.06 10.94 31.18C11.74 31.32 12.04 30.84 12.04 30.42C12.04 30.04 12.02 28.78 12.02 27.44C8 28.18 6.96 26.46 6.64 25.56C6.46 25.1 5.68 23.68 5 23.3C4.44 23 3.64 22.26 4.98 22.24C6.24 22.22 7.14 23.4 7.44 23.88C8.88 26.3 11.18 25.62 12.1 25.2C12.24 24.16 12.66 23.46 13.12 23.06C9.56 22.66 5.84 21.28 5.84 15.16C5.84 13.42 6.46 11.98 7.48 10.86C7.32 10.46 6.76 8.82 7.64 6.62C7.64 6.62 8.98 6.2 12.04 8.26C13.32 7.9 14.68 7.72 16.04 7.72C17.4 7.72 18.76 7.9 20.04 8.26C23.1 6.18 24.44 6.62 24.44 6.62C25.32 8.82 24.76 10.46 24.6 10.86C25.62 11.98 26.24 13.4 26.24 15.16C26.24 21.3 22.5 22.66 18.94 23.06C19.52 23.56 20.02 24.52 20.02 26.02C20.02 28.16 20 29.88 20 30.42C20 30.84 20.3 31.34 21.1 31.18C27.42 29.06 32 23.06 32 16C32 7.16 24.84 0 16 0V0Z"
  />
</svg>
