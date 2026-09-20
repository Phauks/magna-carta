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
   * THIS BROWSER'S OWN MICROPHONE IS NOT HERE. It is never pulled back from the unit, and playing
   * it would be an echo loop.
   */

  let {
    streams,
  }: {
    /** One stream per remote participant, as the client gathered their pulled tracks into it. */
    streams: ReadonlyMap<string, MediaStream>;
  } = $props();

  /** The entries as a list, so each element can be keyed by the participant it plays. */
  const voices = $derived([...streams.entries()]);
</script>

{#each voices as [participantId, stream] (participantId)}
  <!-- svelte-ignore a11y_media_has_caption -->
  <!-- Live sound has no caption track to offer: nothing is transcribing the room, and an empty
       track element would assert captions that do not exist. -->
  <audio
    class="hidden"
    autoplay
    {@attach (element: HTMLAudioElement) => {
      element.srcObject = stream;
      return () => {
        element.srcObject = null;
      };
    }}
  ></audio>
{/each}
