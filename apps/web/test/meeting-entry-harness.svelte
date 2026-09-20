<script lang="ts">
  /* The entry control under the one cache it reads through, which is what a screen gives it. */
  import { QueryClientProvider } from "@tanstack/svelte-query";
  import { queryClient } from "$lib/api/screen-data.ts";
  import MeetingEntryAction from "$lib/meetings/meeting-entry-action.svelte";

  let { eventKind, eventId }: { eventKind: "matter" | "firm"; eventId: string } = $props();
</script>

<QueryClientProvider client={queryClient}>
  <MeetingEntryAction {eventKind} {eventId} />
</QueryClientProvider>
