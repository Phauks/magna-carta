<script lang="ts">
  /*
   * The room at its nine-digit address: /meeting/482-917-305. The dashes are optional; the code is
   * resolved to the meeting, and the room is the same screen Join opens.
   */
  import { page } from "$app/state";
  import { createQuery } from "@tanstack/svelte-query";
  import { meetingsGetByCodeOptions } from "@magna-carta/api-client";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { failureOf } from "$lib/api/api-client.ts";
  import MeetingRoomScreen from "$lib/meetings/meeting-room-screen.svelte";
  import { formatMeetingCode, parseMeetingCode } from "$lib/meetings/meeting-tab.ts";

  const joinCode = $derived(parseMeetingCode(page.params.code ?? ""));
  const read = createQuery(() => ({
    ...meetingsGetByCodeOptions({ path: { joinCode: joinCode ?? "" } }),
    enabled: joinCode !== undefined,
  }));
  const notFound = $derived(read.isError && failureOf(read.error).problem?.status === 404);
</script>

<svelte:head><title>Meeting · Magna Carta</title></svelte:head>

{#if read.data}
  <MeetingRoomScreen meetingId={read.data.meetingId} />
{:else}
  <main class="flex min-h-dvh items-center justify-center p-16">
    {#if joinCode === undefined || notFound}
      <EmptyState title="No Meeting at This Address">
        {joinCode === undefined
          ? "A meeting's address ends in nine digits, like 482-917-305."
          : `Nothing you can join is at ${formatMeetingCode(joinCode)}. Check the code with whoever sent it.`}
      </EmptyState>
    {:else if read.isError}
      <FailureNotice
        failure={failureOf(read.error)}
        subject="The meeting"
        title="Meeting Not Read"
        fallback="The meeting could not be read."
        whenSilent="Nothing answered, so the meeting could not be found."
      />
    {:else}
      <p class="text-sm text-text-muted">Finding the meeting</p>
    {/if}
  </main>
{/if}
