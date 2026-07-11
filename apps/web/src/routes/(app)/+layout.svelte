<script lang="ts">
  /*
   * The (app) route group — every signed-in surface renders inside the App Shell. The session guard
   * lives in the co-located +layout.ts load: an unauthenticated visitor (a 401 from the bootstrap
   * endpoint) is redirected to /login; a transport failure (no Worker behind a frontend-only dev
   * server) lets the shell render anyway.
   *
   * This group is also where the query cache is provided — here, not at the root, because only
   * signed-in surfaces make typed calls; /login must render for someone with no session at all. The
   * transport itself is configured at the root layout's module scope, which runs before any load.
   */
  import { QueryClientProvider } from "@tanstack/svelte-query";
  import AppShell from "$lib/components/app-shell.svelte";
  import { createAppQueryClient } from "$lib/api/query-client.ts";

  let { children } = $props();

  const queryClient = createAppQueryClient();
</script>

<QueryClientProvider client={queryClient}>
  <AppShell>
    {@render children()}
  </AppShell>
</QueryClientProvider>
