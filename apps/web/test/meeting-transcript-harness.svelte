<script lang="ts">
  /*
   * The transcript panel under the one cache it reads through and the Tooltip.Provider the app's
   * root gives every screen, open from the start on one recording. `onSettled` is handed through so
   * a case can see the opener told when a transcript being made settles.
   */
  import { QueryClientProvider } from "@tanstack/svelte-query";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import { queryClient } from "$lib/api/screen-data.ts";
  import TranscriptPanel from "$lib/meetings/screen/transcript-panel.svelte";

  let {
    meetingId,
    recordingId,
    onSettled,
  }: {
    meetingId: string;
    recordingId: string;
    onSettled?: () => void;
  } = $props();

  let open = $state(true);
</script>

<QueryClientProvider client={queryClient}>
  <Tooltip.Provider>
    <TranscriptPanel
      bind:open
      {meetingId}
      {recordingId}
      subject={{ facts: ["Hearing preparation"] }}
      {onSettled}
    />
  </Tooltip.Provider>
</QueryClientProvider>
