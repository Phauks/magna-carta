<script lang="ts">
  /*
   * Who is in the room, as a rail beside it.
   *
   * IT ANSWERS A DIFFERENT QUESTION FROM THE GRID. The grid shows who is on screen, which in a room
   * of three hundred is sixteen of them; this is the list of everybody the room holds, including
   * somebody who has joined and not yet published anything — which is exactly the moment a member
   * asks whether their colleague has arrived, and the moment the grid cannot answer because there
   * is no tile to draw.
   *
   * IT IS SEARCHED ONCE THE LIST OUTGROWS THE EYE. Under a couple of dozen people a member finds a
   * name by reading; past that they are scrolling a list of three hundred to answer "is she here
   * yet", which is what the product's one search control is for. It searches what is already in the
   * browser, so it narrows on the keystroke.
   *
   * IT IS NOT A DIRECTORY RECORD. A participant here is a firm member with a session, not a person
   * or an organization out of the directory, so the mark is the avatar and the name rather than
   * `EntityIdentity` — which carries the directory's own kind glyph and a way through to a record
   * this row does not have.
   */
  import AudioLines from "@lucide/svelte/icons/audio-lines";
  import MicOff from "@lucide/svelte/icons/mic-off";
  import ScreenShare from "@lucide/svelte/icons/screen-share";
  import * as Avatar from "@magna-carta/design-system/avatar";
  import NoResults from "@magna-carta/design-system/no-results";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import { participantInitials, participantName } from "./meeting-tiles.ts";
  import type { MeetingParticipant } from "./meeting-client.svelte.ts";

  /**
   * How many people a member can find by reading. Past it, the rail offers the search control.
   * It is the same number as the audio cap by coincidence, not by relation: this one is about what
   * an eye can scan, that one about what a connection can carry.
   */
  const SEARCHABLE_FROM = 24;

  let {
    participants,
    ownParticipantId = null,
  }: {
    /** Everybody the roster names, this browser included. */
    participants: readonly MeetingParticipant[];
    /** Which of them is this browser, so its row can say so. */
    ownParticipantId?: string | null;
  } = $props();

  let query = $state("");

  const searchable = $derived(participants.length > SEARCHABLE_FROM);
  const shown = $derived.by(() => {
    const asked = query.trim().toLowerCase();
    if (asked === "" || !searchable) return participants;
    return participants.filter((participant) =>
      participantName(participant).toLowerCase().includes(asked),
    );
  });
</script>

<div class="flex h-full min-h-0 flex-col gap-12">
  <div class="flex items-center justify-between gap-8">
    <h2 class="min-w-0 truncate text-sm font-medium text-text-muted">
      In the Room ({participants.length})
    </h2>
    {#if searchable}
      <ScreenSearch bind:value={query} label="Search the room" size="sm" fieldClass="w-full" />
    {/if}
  </div>
  <ul class="mc-scrollbar flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto">
    {#each shown as participant (participant.participantId)}
      {@const name = participantName(participant)}
      {@const silent =
        participant.muted || !participant.tracks.some((track) => track.kind === "audio")}
      {@const shares = participant.tracks.some((track) => track.kind === "screen")}
      <li class="flex items-center gap-8">
        <Avatar.Root>
          <Avatar.Fallback>{participantInitials(name)}</Avatar.Fallback>
        </Avatar.Root>
        <span class="min-w-0 flex-1 truncate text-sm" title={name}>
          {name}{#if participant.participantId === ownParticipantId}<span
              class="text-text-muted">&nbsp;(you)</span
            >{/if}
        </span>
        {#if shares}
          <ScreenShare class="size-16 text-text-muted" aria-label="Sharing a screen" />
        {/if}
        {#if participant.speaking}
          <!-- The one place a row carries the accent: somebody is talking right now, which is the
               fact a member scans this list for while somebody is talking. -->
          <AudioLines class="size-16 text-accent-default" aria-label="Speaking" />
        {:else if silent}
          <MicOff class="size-16 text-text-muted" aria-label="Microphone off" />
        {/if}
      </li>
    {:else}
      <li><NoResults /></li>
    {/each}
  </ul>
</div>
