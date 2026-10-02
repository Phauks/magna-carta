<script lang="ts">
  /*
   * A host's surface about guests under what the app's own root gives it: the one cache its reads
   * go through, and the one Tooltip.Provider its controls read their delays from. It takes the
   * component to draw, so the Guests panel, the roster and the attendance record share one root
   * rather than each growing a harness that differs only by an import.
   *
   * The component is taken as `Component<never>`, which every component is assignable to, and the
   * properties as a plain record: each case states the properties its own surface takes, and the
   * surface checks them as it renders.
   */
  import { QueryClientProvider } from "@tanstack/svelte-query";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import { queryClient } from "$lib/api/screen-data.ts";
  import type { Component } from "svelte";

  let {
    surface,
    properties,
  }: { surface: Component<never>; properties: Record<string, unknown> } = $props();

  const Surface = $derived(surface as unknown as Component<Record<string, unknown>>);
</script>

<QueryClientProvider client={queryClient}>
  <Tooltip.Provider>
    <Surface {...properties} />
  </Tooltip.Provider>
</QueryClientProvider>
