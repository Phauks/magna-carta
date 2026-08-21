<script lang="ts">
  /*
   * A label whose box is as wide as the widest word it could ever hold.
   *
   * These buttons swap words as the run changes phase — Pause becomes Resume, Cancel becomes
   * Restart — and a button sized to its current word resizes when the word changes, shoving
   * everything beside it. Rendering every candidate invisibly in the same grid cell lets the browser
   * measure the widest in the real font; the visible word sits over that reservation and never
   * moves it.
   */
  let { labels, current }: { labels: readonly string[]; current: string } = $props();
</script>

<span class="grid">
  {#each labels as label (label)}
    <span aria-hidden="true" class="invisible col-start-1 row-start-1 whitespace-nowrap">{label}</span>
  {/each}
  <span class="col-start-1 row-start-1 whitespace-nowrap">{current}</span>
</span>
