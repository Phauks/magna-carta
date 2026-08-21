<script lang="ts">
  /*
   * Register — the role fork's page, and the entry point the sign-in card's "Register" link opens.
   *
   * It lives OUTSIDE the (app) route group, beside /login, because everything here happens before
   * anybody has a session; the auth frame is the only chrome a visitor gets.
   *
   * THE TWO INVITED DOORS NAVIGATE, they do not call the API. Both answer `redeemInvitation` from
   * the registration route no matter what, because membership of an existing firm is that firm's
   * decision and nothing a stranger says changes it — so asking costs a round trip and a slice of
   * the anonymous rate-limit budget to be told a constant, and would put the front door of the
   * platform behind the API's availability. The reasoning is written at the fork itself, in
   * $lib/auth/screens/register-screen.svelte.
   */
  import { goto } from "$app/navigation";
  import AuthFrame from "$lib/auth/auth-frame.svelte";
  import type { RegistrationRole } from "$lib/auth/joining-api.ts";
  import RegisterScreen from "$lib/auth/screens/register-screen.svelte";

  async function choose(role: RegistrationRole): Promise<void> {
    await goto(role === "foundFirm" ? "/register/firm" : "/register/invitation");
  }
</script>

<svelte:head><title>Register · Magna Carta</title></svelte:head>

<AuthFrame>
  <RegisterScreen onChoose={choose} back={() => goto("/login")} />
</AuthFrame>
