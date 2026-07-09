<script lang="ts">
  /*
   * BackLink — a small presentational return affordance: a leading back arrow followed by the
   * NAME of the destination (not the word "Back"), so a reader learns where the link goes rather
   * than merely which direction. Built on the design-system Button in its subtle ghost register
   * and rendered as an anchor (Button becomes an <a> when `href` is set), so it navigates like a
   * link while wearing the shared control styling — never a hand-rolled styled <a>.
   *
   * The visible text is the destination alone (e.g. "Tools"); read out of context next to a page
   * masthead of the same shape that bare word is ambiguous, so the anchor carries an explicit
   * accessible name of the form "Back to <destination>". The visible text stays a substring of
   * that name, so the two agree. The arrow is decorative and hidden from assistive technology.
   *
   * Presentational only: the semantic landmark (a `nav`) belongs to whatever places the link.
   */
  import Button from "@magna-carta/design-system/button";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";

  let { href, label }: { href: string; label: string } = $props();
</script>

<Button variant="ghost" size="sm" {href} aria-label={`Back to ${label}`}>
  <ArrowLeft class="size-16" aria-hidden="true" />
  {label}
</Button>
