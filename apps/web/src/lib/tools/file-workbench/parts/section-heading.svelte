<script lang="ts">
  /* The engraved rule a panel divides its findings with. One shape, so every panel divides alike. */
  let { children }: { children: import("svelte").Snippet } = $props();
</script>

<h3
  class="m-0 text-xs font-semibold text-text-subtle uppercase"
  style="letter-spacing: var(--mc-tracking-caps)"
>
  {@render children()}
</h3>
