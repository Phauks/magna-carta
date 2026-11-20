<script lang="ts">
  /*
   * The bot check: Cloudflare Turnstile, drawn just above a signed-out form's main button.
   *
   * It is set to show itself only when Cloudflare wants the person to do something
   * ("interaction-only"), so for almost everybody it is invisible and the form looks as it did
   * before. When the bot check is not set up the server hands back no site key and this draws
   * nothing at all.
   *
   * The page asks for a solution when the form is submitted, through `solution()` on a bound
   * instance. A solution works once, so each one handed out is followed by a reset that starts the
   * next, which is what lets a person who mistyped their password simply press the button again.
   */
  import { onMount } from "svelte";
  import { loadSiteKey, loadTurnstile, type TurnstileApi } from "./human-check.ts";

  let {
    action,
  }: {
    /** A short name for the form, shown in Cloudflare's own Turnstile analytics. */
    action: string;
  } = $props();

  // How long a submit waits for a solution that has not arrived yet: long enough for somebody to
  // answer the challenge when Cloudflare shows one, short enough that a blocked script does not
  // leave the button spinning.
  const SOLUTION_WAIT_MILLISECONDS = 60_000;

  let container = $state<HTMLDivElement | null>(null);
  let turnstile: TurnstileApi | null = null;
  let widgetId: string | null = null;
  // Whether a widget is drawn. False means the check is off here and submits carry nothing.
  let active = false;
  let ready: Promise<void> = Promise.resolve();
  let current: string | null = null;
  let waiters: ((value: string | null) => void)[] = [];

  function settle(value: string | null): void {
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) resolve(value);
  }

  onMount(() => {
    let cancelled = false;
    ready = (async () => {
      const siteKey = await loadSiteKey(fetch);
      if (siteKey === null || cancelled) return;
      const api = await loadTurnstile();
      if (api === null || cancelled || container === null) return;
      turnstile = api;
      active = true;
      widgetId = api.render(container, {
        sitekey: siteKey,
        action,
        appearance: "interaction-only",
        size: "flexible",
        theme: "auto",
        callback: (token: string) => {
          current = token;
          settle(token);
        },
        "expired-callback": () => {
          current = null;
        },
        "error-callback": () => {
          current = null;
          settle(null);
          // Returning true tells Turnstile the error is handled, so it does not also throw it to
          // the console; a fresh attempt starts on the next submit's reset.
          return true;
        },
      });
    })();
    return () => {
      cancelled = true;
      if (turnstile !== null && widgetId !== null) turnstile.remove(widgetId);
      settle(null);
    };
  });

  /**
   * The solution to send with this submit, or `null` when the check is off or did not finish. A
   * `null` while the check is on is answered by the server with a refusal the page words as
   * "the security check didn't finish", which is true.
   */
  export async function solution(): Promise<string | null> {
    await ready;
    if (!active) return null;
    let token = current;
    if (token === null) {
      token = await new Promise<string | null>((resolve) => {
        waiters.push(resolve);
        setTimeout(() => resolve(null), SOLUTION_WAIT_MILLISECONDS);
      });
    }
    // Spent by this submit whatever the answer, so start the next one now.
    current = null;
    if (turnstile !== null && widgetId !== null) turnstile.reset(widgetId);
    return token;
  }
</script>

<div bind:this={container} class="empty:hidden"></div>
