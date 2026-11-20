<script lang="ts">
  /*
   * The pause banner: across the header for as long as the key group says encryption is paused, and
   * gone the moment the commit that resumes it lands.
   *
   * IT CANNOT BE DISMISSED, which is the difference from the recording banner beside it. The claim
   * a member relies on ("this meeting is encrypted end to end") holds for every moment this banner
   * is absent, so a banner somebody could close would be a claim the screen makes falsely. Whoever
   * arrives during a pause sees it on arrival, because it is drawn from the group state rather than
   * from an announcement.
   *
   * The sentence is `pauseSentence`, the one home for it, so a recording with captions on is one
   * sentence rather than two banners. A warning alert, so it is announced as it appears.
   */
  import ShieldOff from "@lucide/svelte/icons/shield-off";
  import * as Alert from "@magna-carta/design-system/alert";
  import { pauseSentence, type EncryptionState } from "../client/encryption-status.ts";

  let {
    encryption,
  }: {
    /** What the meeting's encryption is doing, from `encryptionState`. */
    encryption: EncryptionState;
  } = $props();
</script>

{#snippet shield()}
  <ShieldOff class="mc-alert-icon" aria-hidden="true" />
{/snippet}

{#if encryption.kind === "paused"}
  <Alert.Root variant="warning" icon={shield} data-encryption-pause-notice="">
    <Alert.Title>Encryption Paused</Alert.Title>
    <Alert.Description>{pauseSentence(encryption.reasons)}</Alert.Description>
  </Alert.Root>
{/if}
