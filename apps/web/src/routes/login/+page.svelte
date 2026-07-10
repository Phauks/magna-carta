<script lang="ts">
  /*
   * Sign in — the real login surface. It lives OUTSIDE the (app) route group, so it renders without
   * a session (the (app) layout guard redirects unauthenticated visitors here). The form POSTs email
   * + password to Better Auth's same-origin sign-in endpoint; on success the server sets the session
   * cookie and we navigate into the app (honouring a `next` return path when present), and a 401
   * surfaces a typed credentials error. apps/web does not depend on @magna-carta/api-client (adopting
   * it is an owner decision), so this uses a raw same-origin fetch, matching the WHOIS Lookup page.
   */
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Card from "@magna-carta/design-system/card";
  import { safeReturnPath } from "./return-path.ts";

  const SIGN_IN_ENDPOINT = "/api/auth/sign-in/email";

  let email = $state("");
  let password = $state("");
  let phase = $state<"idle" | "submitting">("idle");
  let error = $state<string | null>(null);

  const submitting = $derived(phase === "submitting");
  const canSubmit = $derived(!submitting && email.trim() !== "" && password !== "");

  async function signIn(event: SubmitEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    phase = "submitting";
    error = null;
    let response: Response;
    try {
      response = await fetch(SIGN_IN_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
    } catch {
      phase = "idle";
      error = "Could not reach the server. Is the local Worker running (vp run worker-dev)?";
      return;
    }
    if (response.ok) {
      await goto(safeReturnPath(page.url.searchParams.get("next")));
      return;
    }
    phase = "idle";
    error =
      response.status === 401
        ? "That email and password do not match. Check them and try again."
        : "Sign-in could not be completed. Try again, and if it persists, contact support.";
  }
</script>

<svelte:head><title>Sign in · Magna Carta</title></svelte:head>

<main class="flex min-h-screen flex-col items-center justify-center bg-surface-default p-24">
  <Card.Root class="w-full max-w-md">
    <Card.Header>
      <Card.Title>Sign in</Card.Title>
      <Card.Description>Enter your firm credentials to continue.</Card.Description>
    </Card.Header>
    <Card.Content>
      <form onsubmit={signIn} class="grid gap-16">
        {#if error}
          <Alert.Root variant="danger">
            <Alert.Description>{error}</Alert.Description>
          </Alert.Root>
        {/if}
        <div class="grid gap-8">
          <Label for="login-email">Email</Label>
          <Input
            id="login-email"
            name="email"
            type="email"
            bind:value={email}
            autocomplete="username"
            placeholder="you@firm.example"
            spellcheck={false}
            disabled={submitting}
            required
          />
        </div>
        <div class="grid gap-8">
          <Label for="login-password">Password</Label>
          <Input
            id="login-password"
            name="password"
            type="password"
            bind:value={password}
            autocomplete="current-password"
            disabled={submitting}
            required
          />
        </div>
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </Card.Content>
  </Card.Root>
</main>
