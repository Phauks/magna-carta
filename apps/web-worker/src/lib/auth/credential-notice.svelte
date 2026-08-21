<script lang="ts">
  /*
   * What a credential entry says after it has failed — shared by the password, the two-factor code
   * and the recovery code, because they share one attempt ladder and must not describe it three
   * different ways.
   *
   * A LOCKOUT REPLACES A REJECTION rather than stacking under it. Once the budget is spent, whether
   * the last attempt was wrong stopped mattering, and two alerts in a column make the visitor read
   * both to find the one that still applies. The countdown and the remedy live in the SAME alert
   * for the same reason: someone reading a lockout is looking for the way out, and a remedy in its
   * own paragraph reads as unrelated advice.
   *
   * The remaining-attempts line sits INSIDE the rejection alert, under the message it qualifies —
   * it is the second half of one statement, not a second notice.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import { LOCKOUT_REMEDY, attemptWarning, lockoutMessage } from "./attempt-ladder.ts";

  let {
    message,
    lockoutSeconds,
    attemptsRemaining,
    subject,
  }: {
    /** The rejection sentence, already chosen by the caller. Null when nothing was rejected. */
    message?: string | null;
    /** Seconds left on a hard lockout. Null when the entry is not locked. */
    lockoutSeconds?: number | null;
    /** How many attempts are left on the shared ladder. Null when the server has not said. */
    attemptsRemaining?: number | null;
    /** What gets locked, in the visitor's terms: "this account", "this sign-in". */
    subject: string;
  } = $props();

  const warning = $derived(
    attemptsRemaining === null || attemptsRemaining === undefined
      ? null
      : attemptWarning(attemptsRemaining, subject),
  );
</script>

{#if lockoutSeconds !== null && lockoutSeconds !== undefined}
  <Alert.Root variant="danger">
    <Alert.Description>
      <span class="flex flex-col gap-4">
        <span>{lockoutMessage(lockoutSeconds)}</span>
        <span class="text-xs">{LOCKOUT_REMEDY}</span>
      </span>
    </Alert.Description>
  </Alert.Root>
{:else if message}
  <Alert.Root variant="danger">
    <Alert.Description>
      <span class="flex flex-col gap-4">
        <span>{message}</span>
        <!--
          The last two rungs of the ladder carry weight; the neutral rung does not. Both class
          strings are literal, because Tailwind's scanner cannot see a computed one.
        -->
        {#if warning}
          {#if warning.tone === "neutral"}
            <span class="text-xs">{warning.message}</span>
          {:else}
            <span class="text-xs font-semibold">{warning.message}</span>
          {/if}
        {/if}
      </span>
    </Alert.Description>
  </Alert.Root>
{/if}
