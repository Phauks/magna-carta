<script lang="ts">
  /*
   * The (app) route group — every signed-in surface renders inside the App Shell. Auth guard
   * seam: when the auth UI lands later in this slice, this layout gains the session check and
   * redirects to /sign-in; until then the shell renders sessionless (interim, spec decision 6).
   */
  import AppShell from "$lib/components/app-shell.svelte";

  let { children } = $props();
</script>

<AppShell>
  {@render children()}
</AppShell>
