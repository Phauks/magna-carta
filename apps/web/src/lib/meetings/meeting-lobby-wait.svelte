<script lang="ts">
  /*
   * What somebody standing at the door sees.
   *
   * IT IS NOT THE ROOM WITH THINGS MISSING. There is no grid, no roster, no control bar and above
   * all no capture: a browser that lit the camera indicator for somebody waiting outside a meeting
   * would be taking a picture nobody asked for, and a control bar offering a microphone that is not
   * being sent anywhere would say the opposite. So this is its own surface, and the only act on it
   * is the one a person at a door actually has: going away again.
   *
   * IT SAYS WHAT IT IS WAITING FOR, AND WHERE THEY STAND. The meeting is named with its day and
   * time, because somebody following a link an hour early should learn that rather than sitting in
   * front of a door nobody is behind; the place in the queue is stated only where somebody is ahead
   * of them, since a line saying nobody is ahead of you says nothing.
   */
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import { waitingPlaceStatement } from "./client/meeting-client.svelte.ts";
  import type { MeetingWaitingPlace } from "./client/meeting-client.svelte.ts";

  let {
    title,
    when = null,
    place = null,
    leaving = false,
    onLeave,
  }: {
    /** The meeting being waited for, by its own title. */
    title: string;
    /** Its day and time, as the header states them, or null before the record has been read. */
    when?: string | null;
    /** Where this browser stands at the door, as the room last stated it. */
    place?: MeetingWaitingPlace | null;
    /** True while giving up is in flight, so the way out cannot be taken twice. */
    leaving?: boolean;
    /** Give up and close this stay. The room lets a waiter close their own. */
    onLeave: () => void;
  } = $props();

  const ahead = $derived(waitingPlaceStatement(place));
</script>

<EmptyState title="Waiting to Be Let In">
  A host has to let you into {title}{when === null ? "" : `, ${when}`}. Nothing is sent from
  your microphone or camera while you wait, and nobody in the room can see or hear you.{#if ahead !== null}&nbsp;{ahead}{/if}
  {#snippet actions()}
    <Button variant="secondary" disabled={leaving} onclick={onLeave}>Leave</Button>
  {/snippet}
</EmptyState>
