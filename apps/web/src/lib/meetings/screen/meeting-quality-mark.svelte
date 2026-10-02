<script lang="ts">
  /*
   * How well somebody's picture and sound are getting through, as one glyph.
   *
   * THE SHAPE CARRIES THE ANSWER, NOT THE COLOUR. Four bars, two, one, none: the ramp is legible at
   * a glance, in both modes, to a reader who cannot tell the two status hues apart, and on a tile
   * whose background is whatever somebody's room happens to look like. Colour is the second
   * statement, and on a work surface it is the calm register — the same subtle status foreground the
   * rest of the product states a standing in, never a saturated block over the data.
   *
   * IT WEARS THE REGISTER OF THE BAND IT SITS IN. A tile's name strip is CHROME (the dark band over
   * an unpredictable picture — meeting-tile.svelte says why), and the deep status foregrounds are
   * gated against the pale tints of the canvas, not against that band. So on chrome the mark reads
   * in the chrome text register and lets the glyph do the work, and on the canvas — the roster rail,
   * the details sheet — it takes the status colour. One hue on both would be an ungated pairing in
   * one of the two places.
   *
   * GOOD IS QUIET AND UNKNOWN IS HONEST. A connection that is fine gets the muted register, because
   * most of the room is fine most of the time and a wall of marks announcing it is noise. Nothing
   * measured yet is its own answer with its own empty glyph: it is not "good", and a mark that says
   * good before anything has been measured is the one that stops being believed.
   */
  import Signal from "@lucide/svelte/icons/signal";
  import SignalLow from "@lucide/svelte/icons/signal-low";
  import SignalMedium from "@lucide/svelte/icons/signal-medium";
  import SignalZero from "@lucide/svelte/icons/signal-zero";
  import type { ConnectionQuality } from "$lib/meetings/client/connection-quality.ts";

  let {
    quality,
    register = "canvas",
    decorative = false,
    class: className = "",
  }: {
    quality: ConnectionQuality;
    /**
     * Which band the mark sits in. `chrome` for a dark band over a picture (a tile's name strip),
     * `canvas` for the ordinary work surface.
     */
    register?: "chrome" | "canvas";
    /**
     * Hide the mark from assistive technology, where the control around it already carries a name.
     * A glyph inside a named button would otherwise be a second name for one control.
     */
    decorative?: boolean;
    class?: string;
  } = $props();

  const GLYPH = {
    good: Signal,
    fair: SignalMedium,
    poor: SignalLow,
    unknown: SignalZero,
  };

  /** What a reader who cannot see the glyph is told. The same sentence in every surface. */
  const LABEL: Record<ConnectionQuality, string> = {
    good: "Connection: good",
    fair: "Connection: fair",
    poor: "Connection: poor",
    unknown: "Connection: not measured yet",
  };

  const TONE: Record<"chrome" | "canvas", Record<ConnectionQuality, string>> = {
    canvas: {
      good: "text-text-muted",
      fair: "text-status-warning-subtle-foreground",
      poor: "text-status-danger-subtle-foreground",
      unknown: "text-text-subtle",
    },
    chrome: {
      good: "text-chrome-text-muted",
      fair: "text-chrome-text-strong",
      poor: "text-chrome-text-strong",
      unknown: "text-chrome-text-muted",
    },
  };

  const Glyph = $derived(GLYPH[quality]);
  const tone = $derived(TONE[register][quality]);
</script>

{#if decorative}
  <Glyph class="size-16 shrink-0 {tone} {className}" aria-hidden="true" />
{:else}
  <Glyph class="size-16 shrink-0 {tone} {className}" aria-label={LABEL[quality]} />
{/if}
