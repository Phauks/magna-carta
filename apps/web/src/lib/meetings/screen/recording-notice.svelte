<script lang="ts">
  /*
   * The recording banner: what just happened to the recording, in a title and one sentence, across
   * the header until the reader dismisses it.
   *
   * ONE BANNER FOR EVERYBODY IN THE ROOM. A member's room and a guest's page draw it from the same
   * concern and in the same words, because the consent ruling is that everybody whose voice is
   * captured is told the same thing; two copies of the markup are two places for that to drift.
   *
   * IT IS NOT A LIVE REGION. Each page keeps one assertive region mounted from its first paint, and
   * that region has already said the sentence; a banner that announced itself as well would say it
   * twice. Dismissing it takes the banner only: the mark in the header is what stays for as long as
   * the recording runs.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import X from "@lucide/svelte/icons/x";
  import type { MeetingRecording } from "../client/recording.svelte.ts";

  let {
    recording,
  }: {
    /** The room's recording concern, which says what to draw and takes the dismissal. */
    recording: MeetingRecording;
  } = $props();
</script>

{#if recording.notice !== null}
  <div class="flex items-start gap-8" data-recording-notice="">
    <Alert.Root
      variant={recording.notice.occasion === "stopped" ? "info" : "warning"}
      role="note"
      class="min-w-0 flex-1"
    >
      <Alert.Title>{recording.notice.title}</Alert.Title>
      <Alert.Description>{recording.notice.sentence}</Alert.Description>
    </Alert.Root>
    <Button variant="ghost" size="icon" aria-label="Dismiss" onclick={() => recording.dismiss()}>
      <X class="size-16" aria-hidden="true" />
    </Button>
  </div>
{/if}
