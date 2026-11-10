<script lang="ts">
  /*
   * The summary panel under the one cache it reads through and the Tooltip.Provider the app's root
   * gives every screen, open from the start on one recording. Who is reading, whether they may host
   * and whether they may assign are handed in as the recordings list hands them, and `onChanged` is
   * handed through so a case can see the opener told.
   */
  import { QueryClientProvider } from "@tanstack/svelte-query";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import { queryClient } from "$lib/api/screen-data.ts";
  import SummaryPanel from "$lib/meetings/screen/summary-panel.svelte";

  let {
    meetingId,
    recordingId,
    canHost = false,
    canAssign = false,
    viewerUserId = null,
    onChanged,
  }: {
    meetingId: string;
    recordingId: string;
    canHost?: boolean;
    canAssign?: boolean;
    viewerUserId?: string | null;
    onChanged?: () => void;
  } = $props();

  let open = $state(true);
</script>

<QueryClientProvider client={queryClient}>
  <Tooltip.Provider>
    <SummaryPanel
      bind:open
      {meetingId}
      {recordingId}
      subject={{ facts: ["Hearing preparation"] }}
      {canHost}
      {canAssign}
      {viewerUserId}
      {onChanged}
    />
  </Tooltip.Provider>
</QueryClientProvider>
