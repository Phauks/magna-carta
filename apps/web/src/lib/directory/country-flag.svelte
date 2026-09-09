<script lang="ts">
  /*
   * A country's flag, beside the country it belongs to.
   *
   * An `<img>` against a vendored SVG, never the flag CHARACTER: those are emoji, which this product
   * does not use (root CLAUDE.md, golden rule 2), and which Windows has no font for at all — the
   * owner's own machine would draw two boxed letters where every other machine drew a flag. The
   * files are static assets fetched lazily, so a list of two hundred countries adds nothing to the
   * bundle and costs a request only for the rows a reader actually looks at.
   *
   * It is decorative in every place it stands: the country is named in words beside it, so a reader
   * who cannot see the flag has lost nothing.
   */
  import { phoneCountryFlag } from "./phone-entry.ts";

  let { region }: { region: string } = $props();
</script>

<img
  src={phoneCountryFlag(region)}
  alt=""
  aria-hidden="true"
  loading="lazy"
  decoding="async"
  class="shrink-0 object-cover"
  style="inline-size: var(--mc-space-24); block-size: var(--mc-space-16)"
/>
