<script lang="ts">
  /*
   * The Security tab: whether the meeting is encrypted end to end right now, the security code in
   * its groups of digits, and who is in the key group.
   *
   * EVERY LINE COMES FROM THE GROUP STATE THIS BROWSER VERIFIED, through `encryption-status.ts`. The
   * roster only puts a name on a stay the group already holds: a member the roster has not named yet
   * is still listed, as an unnamed participant, because the group says it is there and the code is a
   * hash over exactly that list.
   *
   * THE CODE IS SHOWN, NOT REQUIRED. Two people who want certainty read their groups aloud to each
   * other, so the groups are drawn large and in a fixed-width face, three to a row, in the order the
   * code gives them. The list of members scrolls inside the tab, so a room of three hundred costs the
   * tab nothing above it.
   */
  import Copy from "@lucide/svelte/icons/copy";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import ShieldOff from "@lucide/svelte/icons/shield-off";
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Avatar from "@magna-carta/design-system/avatar";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import { toast } from "@magna-carta/design-system/toast";
  import {
    pauseReasonWords,
    type EncryptionState,
    type KeyGroupMember,
  } from "../client/encryption-status.ts";
  import { GUEST_LABEL } from "./meeting-host-labels.ts";
  import { participantInitials } from "./meeting-tiles.ts";

  let {
    encryption,
    codeGroups,
    members,
    isGuest = () => false,
  }: {
    /** What the meeting's encryption is doing, from `encryptionState`. */
    encryption: EncryptionState;
    /** The security code's digit groups, from `securityCodeGroups`; empty outside the group. */
    codeGroups: readonly string[];
    /** Who the verified key group holds, from `encryptionMembers`. */
    members: readonly KeyGroupMember[];
    /** Whether a stay is a guest's, read off the roster where it holds the stay. */
    isGuest?: (participantId: string) => boolean;
  } = $props();

  const UNNAMED = "Unnamed participant";

  async function copyCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(codeGroups.join(" "));
      toast.success("Security code copied.");
    } catch {
      toast.error("Couldn't copy the code. Read it from the screen.");
    }
  }
</script>

{#snippet shieldOff()}
  <ShieldOff class="mc-alert-icon" aria-hidden="true" />
{/snippet}
{#snippet shieldCheck()}
  <ShieldCheck class="mc-alert-icon" aria-hidden="true" />
{/snippet}

<div class="flex min-h-0 flex-col gap-16" data-meeting-security-panel="">
  {#if encryption.kind === "paused"}
    <Alert.Root variant="warning" role="note" icon={shieldOff}>
      <Alert.Title>Paused: {pauseReasonWords(encryption.reasons)}</Alert.Title>
    </Alert.Root>
  {:else if encryption.kind === "on"}
    <Alert.Root variant="success" role="note" icon={shieldCheck}>
      <Alert.Title>End-to-End Encrypted</Alert.Title>
    </Alert.Root>
  {:else if encryption.kind === "failed"}
    <Alert.Root variant="danger" role="note">
      <Alert.Title>Encryption Failed</Alert.Title>
      <Alert.Description>Leave the meeting and join again.</Alert.Description>
    </Alert.Root>
  {:else if encryption.kind === "connecting"}
    <Alert.Root variant="info" role="note">
      <Alert.Title>Connecting</Alert.Title>
      <Alert.Description>The code appears once you're in the group.</Alert.Description>
    </Alert.Root>
  {:else}
    <Alert.Root variant="info" role="note">
      <Alert.Title>Not Encrypted End to End</Alert.Title>
    </Alert.Root>
  {/if}

  {#if codeGroups.length > 0}
    <section class="flex flex-col gap-8" aria-labelledby="meeting-security-code-label">
      <h3 id="meeting-security-code-label" class="text-sm font-medium text-text-muted">
        Security Code
      </h3>
      <ol class="grid grid-cols-3 gap-x-16 gap-y-4" aria-label="Security code, in groups">
        {#each codeGroups as group, index (index)}
          <li class="font-mono text-lg font-semibold tabular-nums">{group}</li>
        {/each}
      </ol>
      <p class="text-sm text-text-muted">
        Everyone in this meeting sees the same code. It changes when someone joins or leaves.
      </p>
      <div>
        <Button variant="secondary" size="sm" onclick={() => void copyCode()}>
          <Copy class="size-16" aria-hidden="true" />
          Copy
        </Button>
      </div>
    </section>
  {/if}

  {#if members.length > 0}
    <section class="flex flex-col gap-8" aria-labelledby="meeting-security-members-label">
      <h3 id="meeting-security-members-label" class="text-sm font-medium text-text-muted">
        Members ({members.length})
      </h3>
      <ul class="flex flex-col divide-y divide-border-default">
        {#each members as member (member.participantId)}
          {@const name = member.displayName ?? UNNAMED}
          <li class="flex items-center gap-8 py-8">
            <Avatar.Root>
              <Avatar.Fallback>{participantInitials(name)}</Avatar.Fallback>
            </Avatar.Root>
            <span
              class="min-w-0 flex-1 truncate text-sm"
              class:text-text-muted={member.displayName === null}
              title={name}>{name}</span
            >
            {#if isGuest(member.participantId)}
              <Badge variant="neutral">{GUEST_LABEL}</Badge>
            {/if}
            {#if member.self}
              <span class="text-sm text-text-muted">You</span>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>
