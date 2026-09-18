<script lang="ts">
  /*
   * Who is in the room, as a rail beside it.
   *
   * IT ANSWERS A DIFFERENT QUESTION FROM THE GRID. The grid shows who is on screen; this is the
   * list of everybody the room holds, including somebody who has joined and not yet published
   * anything — which is exactly the moment a member asks whether their colleague has arrived, and
   * the moment the grid cannot answer because there is no picture to draw.
   *
   * IT IS NOT A DIRECTORY RECORD. A participant here is a firm member with a session, not a person
   * or an organization out of the directory, so the mark is the avatar and the name rather than
   * `EntityIdentity` — which carries the directory's own kind glyph and a way through to a record
   * this row does not have.
   */
  import MicOff from "@lucide/svelte/icons/mic-off";
  import ScreenShare from "@lucide/svelte/icons/screen-share";
  import * as Avatar from "@magna-carta/design-system/avatar";
  import type { MeetingParticipant } from "./meeting-client.svelte.ts";

  let {
    participants,
    ownParticipantId = null,
  }: {
    /** Everybody the roster names, this browser included. */
    participants: readonly MeetingParticipant[];
    /** Which of them is this browser, so its row can say so. */
    ownParticipantId?: string | null;
  } = $props();

  /** The letters an avatar falls back to: the initials of however many words the name has. */
  function initials(name: string): string {
    const letters = name
      .split(/\s+/u)
      .filter((word) => word !== "")
      .map((word) => word[0] ?? "")
      .join("");
    return letters.slice(0, 2).toUpperCase();
  }
</script>

<div class="flex h-full min-h-0 flex-col gap-12">
  <h2 class="text-sm font-medium text-text-muted">In the Room ({participants.length})</h2>
  <ul class="mc-scrollbar flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto">
    {#each participants as participant (participant.participantId)}
      {@const name = participant.displayName === "" ? "Joining" : participant.displayName}
      {@const speaking = participant.tracks.some((track) => track.kind === "audio")}
      {@const shares = participant.tracks.some((track) => track.kind === "screen")}
      <li class="flex items-center gap-8">
        <Avatar.Root>
          <Avatar.Fallback>{initials(name)}</Avatar.Fallback>
        </Avatar.Root>
        <span class="min-w-0 flex-1 truncate text-sm" title={name}>
          {name}{#if participant.participantId === ownParticipantId}<span
              class="text-text-muted">&nbsp;(you)</span
            >{/if}
        </span>
        {#if shares}
          <ScreenShare class="size-16 text-text-muted" aria-label="Sharing a screen" />
        {/if}
        {#if !speaking}
          <MicOff class="size-16 text-text-muted" aria-label="Microphone off" />
        {/if}
      </li>
    {/each}
  </ul>
</div>
