<script lang="ts">
  /*
   * The recordings panel under the one cache it reads through and the Tooltip.Provider the app's
   * root gives every screen, open from the start. `announce` stands in for the room telling this
   * browser a recording started or stopped, which is what makes an open panel read again.
   */
  import { QueryClientProvider } from "@tanstack/svelte-query";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import { queryClient } from "$lib/api/screen-data.ts";
  import RecordingList from "$lib/meetings/screen/recording-list.svelte";
  import type { MeetingRecordingView } from "$lib/meetings/meetings-api.ts";

  let {
    meetingId,
    onWhoWasTold,
  }: {
    meetingId: string;
    onWhoWasTold?: (recording: MeetingRecordingView) => void;
  } = $props();

  let open = $state(true);
  let announced = $state(0);

  /** The room announced a transition. */
  export function announce(): void {
    announced += 1;
  }
</script>

<QueryClientProvider client={queryClient}>
  <Tooltip.Provider>
    <RecordingList
      bind:open
      {meetingId}
      subject={{ facts: ["Hearing preparation"] }}
      {announced}
      {onWhoWasTold}
    />
  </Tooltip.Provider>
</QueryClientProvider>
