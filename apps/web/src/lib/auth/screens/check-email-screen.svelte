<script lang="ts">
  /*
   * Check Your Email — where both doors end, and the only screen on this surface that is a full
   * stop rather than a step.
   *
   * IT IS THE SAME SCREEN FOR BOTH DOORS ON PURPOSE. Founding a firm and redeeming an invitation
   * end in the same place — a mail on its way to an address — and giving each its own celebratory
   * variant would be two screens saying one thing, which is two screens to keep in step.
   *
   * THERE IS NO "SEND AGAIN" BUTTON, and its absence is the honest answer rather than an omission.
   * Nothing on the server resends: a registration is re-sent by registering again (which supersedes
   * the first and invalidates its link), and an invitation cannot be resent by the person redeeming
   * it at all — only the firm that issued it can send another. A resend control here would either
   * do nothing or quietly do something different from what it says, and both are worse than the
   * sentence that tells you what actually works.
   *
   * THE SENT TIME IS WRITTEN OUT IN FULL, in the reader's own zone, because the one question this
   * screen gets asked is "is the mail I am looking at the one this page just sent?" — see
   * ../sent-stamp.ts.
   *
   * THE WAY OUT IS THE PANEL'S OWN BACK CONTROL, at the top of the card where every other screen on
   * this surface keeps it (owner correction, 2026-09-09). It used to be a full-width ghost button at
   * the foot, which put a second, differently-shaped exit on the one screen that is a full stop —
   * and sat it directly under the control that actually matters here. What stays at the foot is the
   * typed-code alternative, which is a way ONWARD rather than a way out.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import AuthPanel from "../auth-panel.svelte";
  import { sentStamp } from "../sent-stamp.ts";

  let {
    address,
    instruction,
    sentAt,
    remedy,
    onEnterCode,
    enterCodeLabel = "Enter the Code Instead",
    back,
    backLabel = "Sign In",
  }: {
    /** The address the mail went to, as the visitor typed or proved it. */
    address: string;
    /** What the mail contains and what to do with it. One sentence. */
    instruction: string;
    /** When the send was made. Rendered in full, in the reader's zone. */
    sentAt: Date;
    /** What to do if it does not arrive — the honest alternative, never "resend". */
    remedy: string;
    /** Offered only where a typed code is a real second way in. */
    onEnterCode?: () => void;
    enterCodeLabel?: string;
    /** Called when the visitor steps back — sign-in, on every caller that has one. */
    back?: () => void;
    backLabel?: string;
  } = $props();
</script>

<AuthPanel title="Check Your Email" {back} {backLabel}>
  {#snippet meta()}{address}{/snippet}

  {#snippet children()}
    <Alert.Root variant="success">
      <Alert.Description>{instruction}</Alert.Description>
    </Alert.Root>

    <div class="flex flex-col gap-8">
      <p class="text-sm text-text-muted">Sent {sentStamp(sentAt)}</p>
      <p class="text-sm text-text-muted">{remedy}</p>
    </div>

    {#if onEnterCode}
      <Button variant="secondary" size="lg" class="w-full" onclick={onEnterCode}>
        {enterCodeLabel}
      </Button>
    {/if}
  {/snippet}
</AuthPanel>
