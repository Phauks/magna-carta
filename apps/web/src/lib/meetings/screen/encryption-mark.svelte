<script lang="ts" module>
  import type { EncryptionState } from "../client/encryption-status.ts";

  /** The words the mark reads in each state, or null where nothing is drawn. */
  export function encryptionMarkWords(encryption: EncryptionState): string | null {
    switch (encryption.kind) {
      case "off":
        return null;
      case "connecting":
        return "Encryption starting";
      case "on":
        return "End-to-end encrypted";
      case "paused":
        return "Encryption paused";
      case "failed":
        return "Encryption failed";
    }
  }
</script>

<script lang="ts">
  /*
   * The encryption mark: a shield and a few words beside the meeting's title, for as long as the
   * meeting is encrypted end to end, paused, or still connecting to its key group.
   *
   * A SHIELD, NEVER A LOCK. The lock in this room already means a host shut the door, and one glyph
   * answering two questions in the same header is a header nobody can read at a glance.
   *
   * THE CALM REGISTER, because the mark stays: success while every frame is sealed, warning while a
   * pause holds. The banner under the header is what interrupts; the mark is what a member glances
   * at. It takes no state of its own: the caller hands it the one projection the banner and the
   * Security tab read, so the three cannot disagree.
   */
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import ShieldEllipsis from "@lucide/svelte/icons/shield-ellipsis";
  import ShieldOff from "@lucide/svelte/icons/shield-off";
  import ShieldX from "@lucide/svelte/icons/shield-x";
  import Badge from "@magna-carta/design-system/badge";

  let {
    encryption,
  }: {
    /** What the meeting's encryption is doing, from `encryptionState`. */
    encryption: EncryptionState;
  } = $props();

  const words = $derived(encryptionMarkWords(encryption));
</script>

{#if words !== null}
  <Badge
    variant={encryption.kind === "on"
      ? "success"
      : encryption.kind === "paused"
        ? "warning"
        : encryption.kind === "failed"
          ? "danger"
          : "neutral"}
    data-encryption-mark={encryption.kind}
  >
    {#if encryption.kind === "on"}
      <ShieldCheck class="size-12" aria-hidden="true" />
    {:else if encryption.kind === "paused"}
      <ShieldOff class="size-12" aria-hidden="true" />
    {:else if encryption.kind === "failed"}
      <ShieldX class="size-12" aria-hidden="true" />
    {:else}
      <ShieldEllipsis class="size-12" aria-hidden="true" />
    {/if}
    {words}
  </Badge>
{/if}
