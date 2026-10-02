<script lang="ts">
  /*
   * The sound of the room, over the map the client replaces every time a pulled track lands.
   *
   * A pull is answered one track at a time and the client gathers a participant's tracks into ONE
   * stream object, so the only things that change when a voice arrives are what that object holds
   * and the map being replaced around it. A case cannot say that from outside without somewhere to
   * hold the map as state, which is what this is.
   */
  import MeetingAudio from "$lib/meetings/screen/meeting-audio.svelte";

  let streams = $state<ReadonlyMap<string, MediaStream>>(new Map());

  /** Hold a participant's stream, the way the client does: a fresh map around the same stream. */
  export function hold(participantId: string, stream: MediaStream): void {
    const next = new Map(streams);
    next.set(participantId, stream);
    streams = next;
  }
</script>

<MeetingAudio {streams} />
