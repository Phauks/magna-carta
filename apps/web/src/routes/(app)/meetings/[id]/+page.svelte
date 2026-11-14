<script lang="ts">
  /*
   * A meeting by its id, which is what Join and Start open. Once the meeting is read, the address bar
   * shows its nine-digit address (/meeting/482-917-305) instead, without leaving the room: the room
   * is the same screen at both addresses, so nothing is drawn again.
   */
  import { replaceState } from "$app/navigation";
  import { page } from "$app/state";
  import { createQuery } from "@tanstack/svelte-query";
  import { meetingsGetOptions } from "@magna-carta/api-client";
  import MeetingRoomScreen from "$lib/meetings/meeting-room-screen.svelte";
  import { meetingCodeAddress } from "$lib/meetings/meeting-tab.ts";

  const meetingId = $derived(page.params.id ?? "");
  const summaryRead = createQuery(() => meetingsGetOptions({ path: { meetingId } }));

  $effect(() => {
    const joinCode = summaryRead.data?.joinCode ?? null;
    if (joinCode === null || typeof window === "undefined") return;
    replaceState(meetingCodeAddress(joinCode), {});
  });
</script>

<MeetingRoomScreen {meetingId} />
