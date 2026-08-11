<script lang="ts">
  /*
   * Verify It's You — which second factor to use.
   *
   * The list renders from what is ENROLLED, CAPABLE and FIRM-PERMITTED, one row per channel per
   * verified number, and nothing else: a row for a channel that cannot deliver is a dead end
   * dressed as a choice. A person with a single authenticator therefore never sees this screen at
   * all — the caller sends them straight to the code entry.
   *
   * Every stored channel is named by its MASKED digits (../code-channels.ts holds the rule and the
   * reasoning). Labels were tried and dropped: they are one more required field at enrolment, and
   * the owner of a phone already knows which of their numbers ends 1284.
   *
   * The recovery-code row sits with the others rather than under a "having trouble?" link. Someone
   * whose phone is in another building is not having trouble with the page.
   */
  import KeyRound from "@lucide/svelte/icons/key-round";
  import Mail from "@lucide/svelte/icons/mail";
  import MessageSquare from "@lucide/svelte/icons/message-square";
  import Phone from "@lucide/svelte/icons/phone";
  import Smartphone from "@lucide/svelte/icons/smartphone";
  import ChoiceRow from "@magna-carta/design-system/choice-row";
  import AuthPanel from "../auth-panel.svelte";
  import type { CodeChannel } from "../code-channels.ts";

  export interface SecondFactorOption {
    /** Stable per row: two numbers can both offer a text channel. */
    id: string;
    channel: CodeChannel;
    /** What choosing this does, in full: "Text a code to +1 (···) ···-1284". */
    label: string;
  }

  let {
    options,
    onChoose,
    onRecoveryCode,
    back,
  }: {
    options: readonly SecondFactorOption[];
    onChoose: (option: SecondFactorOption) => void;
    onRecoveryCode?: () => void;
    back?: () => void;
  } = $props();

  const ICONS = {
    authenticator: Smartphone,
    text: MessageSquare,
    call: Phone,
    email: Mail,
  } as const;
</script>

<AuthPanel title="Verify It's You" {back} backLabel="Back to sign in">
  {#snippet children()}
    <div class="flex flex-col gap-8">
      {#each options as option (option.id)}
        {@const Icon = ICONS[option.channel]}
        <ChoiceRow onclick={() => onChoose(option)}>
          {#snippet icon()}<Icon size={17} />{/snippet}
          {option.label}
        </ChoiceRow>
      {/each}

      {#if onRecoveryCode}
        <ChoiceRow onclick={onRecoveryCode}>
          {#snippet icon()}<KeyRound size={17} />{/snippet}
          Use a recovery code
        </ChoiceRow>
      {/if}
    </div>
  {/snippet}

  {#snippet footer()}
    {#if options.length === 0}
      <p>Your firm's administrator can reset Two-Factor after verifying who you are.</p>
    {/if}
  {/snippet}
</AuthPanel>
