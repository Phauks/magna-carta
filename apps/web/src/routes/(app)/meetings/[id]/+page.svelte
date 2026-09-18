<script lang="ts">
  /*
   * The room. A working surface: the tiles take the height, the controls sit under them, and the
   * roster stands beside.
   *
   * THE ORDER OF ARRIVAL IS THE WHOLE OF THIS FILE. Joining is a WRITE that opens the member's
   * attendance row, and the room refuses a socket upgrade from somebody with no open attendance —
   * so the sequence is join, then open the socket with what the join answered, then publish. Doing
   * any two of those at once produces a refused upgrade that reads exactly like a broken socket.
   *
   * LEAVING IS ITS OWN ACT, AND THE SCREEN MAKES IT ON EVERY WAY OUT. The socket closing does not
   * close attendance on the server (meetings-api.ts says why), so a member who navigates away
   * without this would stay in the record as still in the room — and the room's cap would still be
   * counting them. The control does it, and so does leaving the page.
   *
   * WHAT IS NOT CONFIGURED IS SAID, NOT HIDDEN. A deployment with no conferencing credentials
   * answers the join with a 503, and that is rendered through the same failure surface as any other
   * refusal: the member learns that the firm has not turned meetings on, rather than watching a
   * screen that never fills.
   */
  import { onDestroy } from "svelte";
  import { page } from "$app/state";
  import { beforeNavigate, goto } from "$app/navigation";
  import { createQuery } from "@tanstack/svelte-query";
  import { meetingsGetOptions } from "@magna-carta/api-client";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { formatDate, formatTimeZoneAbbreviation } from "@magna-carta/design-system/formatters";
  import { instantForCivilDateTime } from "@magna-carta/civil-time/time-zone";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { failureOf } from "$lib/api/api-client.ts";
  import { meetingSocketUrl } from "$lib/api/socket-url.ts";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import { formatWallClock } from "$lib/calendar/calendar-api.ts";
  import {
    MeetingClient,
    browserMeetingSeams,
  } from "$lib/meetings/meeting-client.svelte.ts";
  import { meetingTiles, sharedScreenTile } from "$lib/meetings/meeting-tiles.ts";
  import MeetingGrid from "$lib/meetings/meeting-grid.svelte";
  import MeetingControls from "$lib/meetings/meeting-controls.svelte";
  import MeetingRoster from "$lib/meetings/meeting-roster.svelte";
  import {
    endMeeting,
    eventAddress,
    joinMeeting,
    leaveMeeting,
    type MeetingWrite,
  } from "$lib/meetings/meetings-api.ts";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { Failure } from "$lib/api/problem.ts";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";

  const meetingId = $derived(page.params.id ?? "");

  const summaryRead = createQuery(() => meetingsGetOptions({ path: { meetingId } }));
  const summary = $derived(summaryRead.data ?? null);

  const client = new MeetingClient(browserMeetingSeams());

  /** The join's refusal, where joining is what failed. Null while nothing has. */
  let joinFailure = $state<Failure | null>(null);
  /** The end's refusal, rendered in the confirmation panel's own band. */
  let endRefusal = $state<Failure | null>(null);
  /**
   * The meeting this browser currently holds an attendance row on, or null.
   *
   * It is the meeting ID rather than a flag because the address can change WITHOUT this component
   * being destroyed — SvelteKit reuses a page across a parameter change — so a flag would leave a
   * member who walked from one meeting to another joined to neither.
   */
  let joinedMeetingId = $state<string | null>(null);
  /** True while a leave is in flight, so the way out cannot be taken twice. */
  let leaving = $state(false);

  $effect(() => {
    void sessionPermissions.load(fetch);
  });

  const canHost = $derived(sessionPermissions.holds("meetings:host"));

  /*
   * The name this browser is drawn under. The join answers with it, which is the server's own
   * reading of who is asking; until it answers there is no tile to label.
   */
  let displayName = $state("You");

  /*
   * Arrive: join, open the socket with what the join answered, publish. It runs once per meeting —
   * the meeting is recorded as joined BEFORE the write, so a second render cannot start a second
   * attendance on it.
   */
  $effect(() => {
    const id = meetingId;
    if (id === "" || joinedMeetingId === id || summary === null) return;
    // A room this browser has already been in and out of is not walked back into on its own; that
    // is what the Rejoin control is for.
    if (client.state === "ended") return;
    // The summary in hand may still be the PREVIOUS meeting's for a frame after the address moved,
    // and joining on it would read the wrong standing.
    if (summary.id !== id) return;
    // A meeting nobody can be in is not joined: a 503 or a closed room would be the answer, and
    // asking for it would open an attendance row on a meeting that is over.
    if (!summary.configured || summary.status === "ended") return;
    joinedMeetingId = id;
    leaving = false;
    void arrive(id);
  });

  async function arrive(id: string): Promise<void> {
    const outcome = await joinMeeting(id);
    if (outcome.kind !== "ok") {
      joinFailure = outcome.failure;
      return;
    }
    joinFailure = null;
    displayName = outcome.value.displayName;
    client.join({
      meetingId: id,
      participantId: outcome.value.participantId,
      iceServers: outcome.value.iceServers,
      socketUrl: meetingSocketUrl(id),
    });
    await client.publish();
  }

  /*
   * Go: tell the room, close the attendance row, and go back to the event this meeting hangs on.
   * The write is not awaited before navigating away on a teardown — see `depart` below — but it is
   * here, because a member who pressed Leave is watching and a failure is theirs to see.
   */
  async function leave(): Promise<void> {
    const id = joinedMeetingId;
    if (leaving || id === null) return;
    leaving = true;
    joinedMeetingId = null;
    client.leave();
    await leaveMeeting(id);
    await goto(backAddress);
  }

  /*
   * The same act on the way out of the page, best effort. A navigation cannot be held open for a
   * round trip, so the write is fired and the member is let go; the room also drops the socket,
   * and the sweep on the server is what closes an attendance this never reached.
   */
  function depart(): void {
    const id = joinedMeetingId;
    if (id === null) return;
    joinedMeetingId = null;
    client.dispose();
    void leaveMeeting(id);
  }

  /*
   * The room ending closes every attendance on the server at one instant, so there is nothing left
   * for this browser to close on its way out and a leave sent afterwards would be asking to close a
   * row that is already closed.
   */
  $effect(() => {
    if (client.state === "ended") joinedMeetingId = null;
  });

  beforeNavigate(() => {
    depart();
  });
  onDestroy(() => {
    depart();
  });

  async function end(): Promise<ActionOutcome> {
    endRefusal = null;
    const outcome: MeetingWrite<unknown> = await endMeeting(meetingId);
    // Ending is not leaving: the room broadcasts `ended` and closes every socket, which is what
    // takes this browser out of the room and settles the screen on its ended state.
    if (outcome.kind === "ok") return "committed";
    endRefusal = outcome.failure;
    return "refused";
  }

  /*
   * Go back in after the socket went away. The attendance row is opened again from scratch rather
   * than the socket being re-dialled: the room refuses an upgrade from somebody with no open
   * attendance, and this browser cannot know whether the one it had was closed on the way down.
   */
  function rejoin(): void {
    joinedMeetingId = null;
    joinFailure = null;
  }

  function toggleSharing(): void {
    if (client.sharing) void client.stopSharing();
    else void client.shareScreen();
  }

  // ---- what the header says -------------------------------------------------------------------

  const title = $derived(summary?.title ?? "Meeting");

  /*
   * The zone's shortcode is worked out on the RECORD'S OWN DAY: the same zone is PST in January and
   * PDT in July, so a code taken from today would be wrong about half the year's meetings.
   */
  const zoneCode = $derived.by(() => {
    if (summary === null) return "";
    return formatTimeZoneAbbreviation(
      summary.timeZone,
      new Date(instantForCivilDateTime(summary.startsOn, summary.startsAtTime, summary.timeZone)),
    );
  });

  /*
   * The clock, read in the EVENT'S own zone rather than the reader's, which is why the reader zone
   * passed to the shared formatter is the event's: the zone is stated once at the end of the line
   * as a shortcode instead of being repeated in full beside every time.
   */
  const startsAt = $derived(
    summary === null
      ? null
      : formatWallClock(summary.startsAtTime, summary.timeZone, summary.timeZone),
  );
  const endsAt = $derived(
    summary === null
      ? null
      : formatWallClock(summary.endsAtTime, summary.timeZone, summary.timeZone),
  );

  const backAddress = $derived(
    summary === null
      ? "/calendar"
      : eventAddress(summary.eventKind, summary.eventId, summary.matterId),
  );

  const endSubject = $derived<RecordSubject>(summary === null ? {} : { facts: [summary.title] });

  // ---- what the grid draws --------------------------------------------------------------------

  const tiles = $derived(meetingTiles(client, displayName));
  const sharedScreen = $derived(sharedScreenTile(client, displayName));

  /*
   * The meeting is over when the room says so, and also when the record already said so before this
   * browser arrived — somebody following a link to a meeting that ended last Tuesday.
   */
  const over = $derived(client.state === "ended" || summary?.status === "ended");
  const unconfigured = $derived(summary !== null && !summary.configured);
</script>

<svelte:head><title>{title} · Magna Carta</title></svelte:head>

<div class="flex h-full min-h-0 flex-col gap-16">
  <ScreenHeader {title}>
    {#snippet meta()}
      {#if summary !== null}
        <span>{formatDate(summary.startsOn)}</span>
        {#if startsAt !== null}
          <span>{endsAt === null ? startsAt : `${startsAt} to ${endsAt}`} {zoneCode}</span>
        {/if}
        <span>{summary.liveCount === 1 ? "1 in the room" : `${summary.liveCount} in the room`}</span>
      {/if}
    {/snippet}
  </ScreenHeader>

  <LoadingRegion
    class="flex min-h-0 flex-1 flex-col gap-16"
    loading={summaryRead.isPending}
    label="Reading this meeting"
    failed={summaryRead.isError}
  >
    {#snippet failure()}
      <FailureNotice
        failure={failureOf(summaryRead.error)}
        subject="This meeting"
        fallback="This meeting could not be read."
        whenSilent="Nothing answered. This meeting could not be read."
        onRetry={() => void summaryRead.refetch()}
      />
    {/snippet}

    {#if unconfigured}
      <EmptyState title="Meetings Are Not Turned On">
        Meetings have not been turned on for this firm, so a room cannot be opened here. An
        administrator is who puts that right.
        {#snippet actions()}
          <Button variant="secondary" href={backAddress}>Back to the Event</Button>
        {/snippet}
      </EmptyState>
    {:else if over}
      <EmptyState title="Meeting Ended">
        The room is closed. Who was in it and for how long stays on the record.
        {#snippet actions()}
          <Button variant="secondary" href={backAddress}>Back to the Event</Button>
        {/snippet}
      </EmptyState>
    {:else if joinFailure !== null}
      <FailureNotice
        failure={joinFailure}
        subject="This meeting"
        title="You Are Not in the Room"
        fallback="You were not joined to this meeting."
        whenSilent="Nothing answered. You were not joined to this meeting."
      />
    {:else}
      <!-- The room's own faults are not API failures and are not dressed as them: no request was
           refused, so there is no Error ID to carry and no retry that would mean anything. The
           statement says what happened and the way back in is the control beside it. -->
      {#if client.state === "failed"}
        <div class="flex flex-col items-start gap-8">
          <Alert.Root variant="warning">
            <Alert.Title>The Room Stopped Answering</Alert.Title>
            <Alert.Description>
              The connection to the room ended and nothing is being sent or received.
            </Alert.Description>
          </Alert.Root>
          <Button variant="secondary" onclick={rejoin}>Rejoin</Button>
        </div>
      {/if}

      {#if client.captureRefusal !== null}
        <Alert.Root variant="info">
          <Alert.Title>Nothing Is Being Sent</Alert.Title>
          <Alert.Description>{client.captureRefusal}</Alert.Description>
        </Alert.Root>
      {/if}

      <div class="flex min-h-0 flex-1 gap-16">
        <div class="min-h-0 min-w-0 flex-1">
          <MeetingGrid {tiles} {sharedScreen} />
        </div>
        <aside class="hidden min-h-0 w-3xs shrink-0 lg:block">
          <MeetingRoster
            participants={client.participants}
            ownParticipantId={client.participantId}
          />
        </aside>
      </div>

      <MeetingControls
        microphoneOn={client.microphoneOn}
        cameraOn={client.cameraOn}
        sharing={client.sharing}
        canEnd={canHost}
        subtitle={endSubject}
        onToggleMicrophone={() => client.toggleMicrophone()}
        onToggleCamera={() => client.toggleCamera()}
        onToggleSharing={toggleSharing}
        onLeave={() => void leave()}
        onEnd={end}
      >
        {#snippet endFailure()}
          {#if endRefusal !== null}
            <FailureNotice
              failure={endRefusal}
              subject="This meeting"
              title="Nothing Changed"
              fallback="The meeting was not ended."
              whenSilent="Nothing answered. The meeting was not ended and is still running."
            />
          {/if}
        {/snippet}
      </MeetingControls>
    {/if}
  </LoadingRegion>
</div>
