<script lang="ts">
  /*
   * Register — the role fork, and the first thing a visitor sees after leaving the sign-in card.
   *
   * THREE EQUALLY WEIGHTED CHOICES, AND THE WORDING IS THE EXPLANATION. Nothing sits under them: a
   * supporting line beneath each choice would be three more sentences to read before the one
   * decision that has to be made, and the choices are already written as the sentences somebody
   * would say out loud about themselves.
   *
   * TWO OF THE THREE END AT THE SAME PLACE, and that is the point rather than an accident. Whether
   * a person is a client of a firm or works at one, membership of an existing firm is that firm's
   * decision, so both doors lead to invitation redemption and neither creates anything. Only
   * founding a firm creates. The registration route (apps/api-worker/src/routes/registrations.ts) says
   * the same thing on the server side, answering `redeemInvitation` for both — the fork is settled
   * in the browser because the answer is a constant, and spending a round trip and a slice of the
   * anonymous rate-limit budget to be told a constant would leave the front door of the platform
   * unreachable whenever the API was having a bad minute.
   *
   * FULL BODY SIZE ON EVERY CHOICE. The design system's ChoiceRow is the nearer-looking component
   * and is deliberately not used: its name part is fixed at the small step, and a reduced font on
   * the registration copy was rejected outright. The large ghost button is the same tokens at the
   * body size, which is what a decision this size should be set in.
   */
  import Button from "@magna-carta/design-system/button";
  import AuthPanel from "../auth-panel.svelte";
  import type { RegistrationRole } from "../joining-api.ts";

  let {
    onChoose,
    back,
  }: {
    onChoose: (role: RegistrationRole) => void;
    back?: () => void;
  } = $props();

  /*
   * The three sentences, verbatim and in this order. They are owner-settled copy, not labels
   * generated from the role names — editing one to read "more consistently" is how a fork that
   * says what it means turns back into a list of nouns.
   */
  const DOORS: ReadonlyArray<{ role: RegistrationRole; label: string }> = [
    { role: "clientOfFirm", label: "I am a client at a law firm" },
    { role: "firmMember", label: "I work at a law firm" },
    { role: "foundFirm", label: "I want to start a new law firm" },
  ];
</script>

<AuthPanel title="Register" {back} backLabel="Back to sign in">
  {#snippet children()}
    <div class="flex flex-col gap-8">
      {#each DOORS as door (door.role)}
        <Button
          variant="ghost"
          size="lg"
          class="w-full justify-start text-start"
          onclick={() => onChoose(door.role)}
        >
          {door.label}
        </Button>
      {/each}
    </div>
  {/snippet}
</AuthPanel>
