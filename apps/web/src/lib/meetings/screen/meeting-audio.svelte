<script lang="ts">
  /*
   * Every voice the room is sending this browser, played once.
   *
   * IT IS NOT THE TILES' JOB, because the people you HEAR are not the people you SEE. A browser
   * pulls up to twenty-four microphones and draws at most sixteen tiles, and the two sets are
   * ranked differently on purpose: somebody answering a question from page four is pulled and
   * played while their tile is nowhere on screen. Playing sound through the tiles would silence
   * exactly the person who just spoke, which is the failure a large room notices first.
   *
   * ONE ELEMENT PER PARTICIPANT, keyed by who they are, so a stream that gains a track keeps
   * playing rather than being re-created underneath the sound. Nothing here is visible: this
   * component draws no surface, occupies no space, and exists only to be heard.
   *
   * AN ELEMENT FOLLOWS ITS STREAM'S TRACKS, NOT ONLY THE STREAM. A pull is answered one track at a
   * time, so a participant's camera can land before their microphone — and the stream the client
   * gathers them into is the SAME object throughout, so an element pointed at it once, while it
   * held only a picture, would play nothing for the rest of the meeting. What is carried is read
   * below, which is what makes the element re-point when a voice arrives.
   *
   * THIS BROWSER'S OWN MICROPHONE IS NOT HERE. It is never pulled back from the unit, and playing
   * it would be an echo loop.
   */

  let {
    streams,
  }: {
    /** One stream per remote participant, as the client gathered their pulled tracks into it. */
    streams: ReadonlyMap<string, MediaStream>;
  } = $props();

  /**
   * The entries as a list, each with how many voices its stream is carrying right now.
   *
   * The count is what ties an element to the stream's CONTENTS. The client replaces this map every
   * time a pulled track lands, so this is worked out again then, and a stream that has just gained
   * a microphone is a different answer from the same stream a moment earlier.
   */
  const voices = $derived(
    [...streams.entries()].map(([participantId, stream]) => ({
      participantId,
      stream,
      voiceCount: stream.getAudioTracks().length,
    })),
  );
</script>

{#each voices as voice (voice.participantId)}
  <!-- svelte-ignore a11y_media_has_caption -->
  <!-- Live sound has no caption track to offer: nothing is transcribing the room, and an empty
       track element would assert captions that do not exist. -->
  <audio
    class="hidden"
    autoplay
    {@attach (element: HTMLAudioElement) => {
      // A stream with no voice in it yet has nothing to play, and saying so rather than pointing at
      // it anyway is what makes this depend on the track set instead of on the stream object alone.
      element.srcObject = voice.voiceCount === 0 ? null : voice.stream;
      return () => {
        element.srcObject = null;
      };
    }}
  ></audio>
{/each}
