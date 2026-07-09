<script lang="ts">
  /*
   * BackLink — a small presentational return affordance: a leading back arrow followed by the
   * NAME of the destination (not the word "Back"), so a reader learns where the link goes rather
   * than merely which direction. Built on the design-system Button in its subtle ghost register
   * and rendered as an anchor (Button becomes an <a> when `href` is set), so it navigates like a
   * link while wearing the shared control styling — never a hand-rolled styled <a>.
   *
   * It sits directly above a page masthead, so it wears the masthead's own eyebrow register (see
   * masthead-eyebrow.svelte): the letterspaced small-caps kicker in the subtle text colour at the
   * xs step. That register makes it read as a quiet supra-title label attached to the heading
   * beneath it, not as a chip-sized control floating above the page. The xs size comes from the
   * Button `sm` recipe; the caps tracking is a raw token reference because no Tailwind utility
   * maps --mc-tracking-caps (the app reaches it this way everywhere small-caps text is set).
   *
   * The `sm` recipe pads the control inline, which indents the arrow relative to the masthead title
   * beneath it. An equal negative inline-start margin pulls the control back so the arrow lands on
   * the title's own left edge, while the pad stays to carry the ghost hover fill around the glyphs.
   * The pull is written as an inline token reference rather than a `-ms-*` utility: this build emits
   * no negative logical inline utility (verified in the browser — `-ms-*` computes to zero while
   * `-m-*` works), so the utility would read correctly in source and do nothing on the page.
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

<Button
  variant="ghost"
  size="sm"
  {href}
  aria-label={`Back to ${label}`}
  class="font-semibold text-text-subtle uppercase"
  style="letter-spacing: var(--mc-tracking-caps); margin-inline-start: calc(var(--mc-space-12) * -1)"
>
  <ArrowLeft class="size-12" aria-hidden="true" />
  {label}
</Button>
