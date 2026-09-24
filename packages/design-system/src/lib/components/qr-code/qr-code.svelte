<script lang="ts">
  /*
   * QrCode — a value drawn as a QR symbol a phone camera can read (Tier 1, no Bits UI).
   *
   * Its first caller is two-factor enrolment, where an authenticator app scans the secret off the
   * screen; anything else that hands a phone a short string across the gap between two devices is
   * the same component.
   *
   * DARK ON LIGHT IN EVERY MODE. A scanner reads dark modules on a light field. Inverted symbols
   * are in the specification, but plenty of authenticator apps' cameras refuse them, and a code
   * that works on one person's phone and not another's is worse than no code. So the symbol cannot
   * take the page's surface and text colours, which turn over in dark mode. It takes the CHROME
   * pair instead: the one pair of tokens that is the same in both modes, the app bar's surface and
   * its strong text. The surface is the ink and the text is the paper, and the pair is already
   * held to AA contrast in every theme (@magna-carta/design-tokens contrast-pairs.ts).
   *
   * IT IS NOT DECORATION. The label is required and is the symbol's accessible name, because the
   * value itself is unreadable to anybody who cannot see the picture. A caller must also put the
   * same value on the page as text (the two-factor panel shows the secret beside it): a symbol is
   * one way in, never the only one.
   */
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { qrGeometry } from "./qr-code-model.ts";

  let {
    value,
    label,
    class: className,
  }: {
    /** What the symbol encodes. */
    value: string;
    /** What the symbol is, for anybody who cannot see it — "QR code for your authenticator app". */
    label: string;
    class?: string;
  } = $props();

  const geometry = $derived(qrGeometry(value));
</script>

<svg
  role="img"
  aria-label={label}
  viewBox="0 0 {geometry.extent} {geometry.extent}"
  shape-rendering="crispEdges"
  class={mergeClasses("block aspect-square w-full max-w-3xs rounded-sm", className)}
>
  <rect width={geometry.extent} height={geometry.extent} class="fill-chrome-text-strong" />
  <path d={geometry.path} class="fill-chrome-surface" />
</svg>
