<script lang="ts">
  /*
   * A guest's meeting under what the app's own root gives every route: the one cache and the one
   * Tooltip.Provider. Nothing else — a guest's page inherits no shell, and neither does this.
   */
  import { QueryClientProvider } from "@tanstack/svelte-query";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import { queryClient } from "$lib/api/screen-data.ts";
  import GuestMeeting from "$lib/meetings/guest-meeting.svelte";
  import type { ComponentProps } from "svelte";

  let props: ComponentProps<typeof GuestMeeting> = $props();
</script>

<QueryClientProvider client={queryClient}>
  <Tooltip.Provider>
    <GuestMeeting {...props} />
  </Tooltip.Provider>
</QueryClientProvider>
