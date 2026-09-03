<script lang="ts">
  /*
   * Home — the Dashboard archetype's stage-1 form: the greeting masthead (the page's one
   * ceremonial edge, with the quote-of-the-day riding the baseline) over an honest empty state.
   * The widget grid (my tasks / today / needs attention) assembles here as its slices ship;
   * nothing is faked meanwhile.
   */
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import ScreenHeader from "$lib/screen/screen-header.svelte";

  const now = new Date();
  const hour = now.getHours();
  const daypart = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const today = now.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
</script>

<svelte:head>
  <title>Home · Magna Carta</title>
</svelte:head>

<ScreenHeader
  title="Good {daypart}"
  class="mb-24"
>
  {#snippet meta()}
    <span>{today}</span>
  {/snippet}
</ScreenHeader>

<EmptyState title="Your day assembles here">
  Tasks, deadlines, and the matters you touch will gather on this page as the firm's work begins —
  open the first matter to start.
  {#snippet actions()}
    <Button variant="primary" href="/matters">Go to matters</Button>
  {/snippet}
</EmptyState>

<!-- Quote of the day — the dashboard's heritage colophon (placement owner-approved as an option;
     rotation + accurate-citation set arrives with the dashboard proper).

     THE ARCHIVE LINK CONTRACT (owner, 2026-07-03): the quote itself is the door to the Quote
     Archive site — the public record of every day's quote with its source and associated
     documents. Plain text today (never a dead link); when that site exists, the quote wraps in
     an anchor to the day's entry (the archive's base URL — a constant introduced here when the
     site ships, deliberately NOT an ecosystem-sites row: the archive is reached only through
     the quote — plus a date path). -->
<footer
  class="mt-40 flex items-baseline justify-center gap-8 border-t border-border-default pt-12 text-sm"
>
  <!-- The display face has no utility on purpose (it enters through Masthead); a heritage quote
       is the other sanctioned door, so it reads the token directly. -->
  <span class="italic text-text-muted" style="font-family: var(--mc-font-display)">
    "We will sell to no man, we will not deny or defer to any man either Justice or Right."
  </span>
  <cite class="text-xs whitespace-nowrap text-subtle not-italic">Magna Carta, 1297 · ch. XXIX</cite>
</footer>
