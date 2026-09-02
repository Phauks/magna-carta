<script lang="ts">
  /*
   * The controls a failure offers — chosen from what the server actually said, never from what the
   * surface guesses.
   *
   * NOTHING RENDERS THAT CANNOT DO ANYTHING. A refusal nobody can retry their way out of gets no
   * Retry; a step-up or an access request appears only where the surface passed a handler for it,
   * because a button that opens nothing is worse than a sentence telling the member who to ask. The
   * one remedy this component can always honour by itself is signing back in, so that one is a real
   * link rather than a handler the caller has to remember to wire.
   */
  import { page } from "$app/state";
  import Button from "@magna-carta/design-system/button";
  import type { Remedy } from "./guidance.ts";

  let {
    remedy,
    size = "sm",
    onRetry,
    onReport,
    onStepUp,
    onRequestAccess,
  }: {
    remedy: Remedy;
    size?: "sm" | "default";
    /** Read again. Absent where the surface has no way to re-run the call. */
    onRetry?: () => void;
    /** Open the report dialog. Absent where the surface has not wired one yet. */
    onReport?: () => void;
    /** Start a re-authentication. Absent until the surface has a step-up flow. */
    onStepUp?: () => void;
    /** Ask for access to what was refused. Absent until the surface has a request flow. */
    onRequestAccess?: () => void;
  } = $props();

  // Counts down the server's own lockout window, so the control says WHEN rather than failing again
  // immediately. Seeded from the remedy and restarted whenever a new one arrives.
  let secondsLeft = $state(0);
  $effect(() => {
    if (remedy.kind !== "retryAfter") {
      secondsLeft = 0;
      return;
    }
    secondsLeft = remedy.seconds;
    const timer = setInterval(() => {
      secondsLeft = Math.max(0, secondsLeft - 1);
      if (secondsLeft === 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  });

  const signInHref = $derived(
    `/login?next=${encodeURIComponent(page.url.pathname + page.url.search)}`,
  );
</script>

{#if remedy.kind === "retry" && onRetry !== undefined}
  <Button variant="primary" {size} onclick={onRetry}>Retry</Button>
{:else if remedy.kind === "retryAfter" && onRetry !== undefined}
  <Button variant="primary" {size} disabled={secondsLeft > 0} onclick={onRetry}>
    {secondsLeft > 0 ? `Retry in ${secondsLeft}s` : "Retry"}
  </Button>
{:else if remedy.kind === "signIn"}
  <Button variant="primary" {size} href={signInHref}>Sign in again</Button>
{:else if remedy.kind === "stepUp" && onStepUp !== undefined}
  <Button variant="primary" {size} onclick={onStepUp}>Confirm identity</Button>
{:else if remedy.kind === "requestAccess" && onRequestAccess !== undefined}
  <Button variant="primary" {size} onclick={onRequestAccess}>Request access</Button>
{/if}

{#if onReport !== undefined}
  <Button variant="secondary" {size} onclick={onReport}>Report a problem</Button>
{/if}
