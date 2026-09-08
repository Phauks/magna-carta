<script lang="ts">
  /*
   * The human-verification challenge, as a widget that mints the token an anonymous write needs.
   *
   * THIS IS THE COMPONENT THE ACTIVATION ORDER HAS BEEN WAITING ON. The server side has been built
   * and dormant since 2026-08-15: it refuses any request carrying no solution the moment a secret is
   * provisioned, and the live joining screens mint nothing — so setting the secret first would turn
   * every real signup into a 403. The public intake form is the one anonymous surface with no shipped
   * client to break, so it carries this from its first commit, and /register and the
   * invitation-redemption screen take the same component when they are wired.
   *
   * IT IS ABSENT UNTIL A SITE KEY EXISTS, AND THAT IS THE WHOLE DESIGN. `siteKey` is null in every
   * environment where no widget has been created in the Cloudflare dashboard, and this renders
   * nothing at all — no box, no explanation, no placeholder row. The server's matching posture is to
   * serve the endpoint unprotected and COUNT every unprotected pass, so the gap is a number on a
   * dashboard rather than a claim on a page. A placeholder that looked like a challenge and verified
   * nothing would be worse than an honest absence: it would tell a firm they were protected.
   *
   * The token is a bearer credential with a short life and ONE use. It is held here, handed to the
   * caller through `onToken`, and never logged, never put in a URL, and never stored. A solution that
   * expires clears itself, because a stale token is refused by the server and a visitor pressing Send
   * with one would be told to try again for a reason they cannot see.
   */
  import { onMount } from "svelte";

  interface Props {
    /**
     * The public site key from the Cloudflare dashboard, or null where none is provisioned.
     * Null renders nothing.
     */
    readonly siteKey: string | null;
    /** Called with the solution, or with null when it expires or fails and must be solved again. */
    readonly onToken: (token: string | null) => void;
  }

  const { siteKey, onToken }: Props = $props();

  let host = $state<HTMLDivElement | null>(null);
  let widgetId: string | null = null;

  // Managed mode, the mode all four merged designs name: it shows a challenge only to the small
  // minority of attempts that warrant one, which is what makes an extra row on a form honest. Not
  // Invisible — a form that pauses should be able to show a person why.
  const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

  interface TurnstileApi {
    render(
      element: HTMLElement,
      options: {
        sitekey: string;
        callback: (token: string) => void;
        "expired-callback": () => void;
        "error-callback": () => void;
        theme: "auto";
      },
    ): string;
    remove(id: string): void;
  }

  function turnstile(): TurnstileApi | undefined {
    return (globalThis as { turnstile?: TurnstileApi }).turnstile;
  }

  async function loadScript(): Promise<void> {
    if (turnstile() !== undefined) return;
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(
        `script[src="${TURNSTILE_SCRIPT}"]`,
      );
      if (existing !== null) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("turnstile")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      script.defer = true;
      script.addEventListener("load", () => resolve(), { once: true });
      script.addEventListener("error", () => reject(new Error("turnstile")), { once: true });
      document.head.append(script);
    });
  }

  onMount(() => {
    if (siteKey === null) return;
    let disposed = false;

    void (async () => {
      try {
        await loadScript();
      } catch {
        // The challenge script did not load. Report no token and say nothing on the page: the
        // server decides what an unsolved request is worth, and a visitor cannot act on this.
        onToken(null);
        return;
      }
      const api = turnstile();
      if (disposed || api === undefined || host === null) return;
      widgetId = api.render(host, {
        sitekey: siteKey,
        callback: (token) => onToken(token),
        // A solved challenge goes stale. Clearing it is what stops a visitor pressing Send with a
        // token the server will refuse for a reason they cannot see.
        "expired-callback": () => onToken(null),
        "error-callback": () => onToken(null),
        theme: "auto",
      });
    })();

    return () => {
      disposed = true;
      const api = turnstile();
      if (widgetId !== null && api !== undefined) api.remove(widgetId);
      widgetId = null;
    };
  });
</script>

{#if siteKey !== null}
  <div bind:this={host}></div>
{/if}
