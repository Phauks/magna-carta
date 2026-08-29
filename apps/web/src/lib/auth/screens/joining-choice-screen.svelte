<script lang="ts">
  /*
   * Welcome — the dedicated screen that resolves what an account IS, and the second half of joining.
   *
   * IT IS REACHED SIGNED IN, WHICH IS THE WHOLE POINT. The question it asks — which firm do you
   * belong to — is a question about a relationship, and the surface that asks it can only ask it
   * once there is somebody to have one. Registration makes the person; this settles the rest.
   *
   * TWO CHOICES, AND BOTH ARE REAL. Starting a firm and redeeming an invitation are the only two
   * things the server can actually do, so they are the only two things rendered as controls. What is
   * NOT built is named underneath in words rather than offered as a button that does nothing —
   * ../joining-availability.ts is the register those sentences come from, so the day a gap closes,
   * one entry moves and this screen follows.
   *
   * NEITHER CHOICE IS THE RECOMMENDED ONE. The founding button carries the primary weight because it
   * is the act that creates something, not because it is the expected answer; a person holding an
   * invitation reads one line and presses the other. Both sit at full body size, the same decision
   * the register fork was set in before it.
   */
  import Building2 from "@lucide/svelte/icons/building-2";
  import TicketCheck from "@lucide/svelte/icons/ticket-check";
  import Button from "@magna-carta/design-system/button";
  import AuthPanel from "../auth-panel.svelte";
  import { JOINING_STEPS } from "../joining-availability.ts";

  let {
    name,
    onFoundFirm,
    onRedeemInvitation,
  }: {
    /** Who is signed in, so the screen is addressed to somebody rather than to nobody. */
    name?: string;
    onFoundFirm: () => void;
    onRedeemInvitation: () => void;
  } = $props();

  // What this surface cannot do, read from the one register rather than written here. Only the
  // entries that belong to THIS decision are shown: a person choosing how they join has no use for
  // the reach of a step they have already taken.
  const unbuiltDoors = JOINING_STEPS.filter((step) => step.reach === "unbuilt");
</script>

<AuthPanel title="Welcome to Magna Carta">
  {#snippet meta()}
    {#if name}Signed in as {name}. One thing left: tell us where you work.{:else}One thing left:
      tell us where you work.{/if}
  {/snippet}

  {#snippet children()}
    <div class="flex flex-col gap-8">
      <Button
        variant="primary"
        size="lg"
        class="w-full justify-start text-start"
        onclick={onFoundFirm}
      >
        <Building2 size={18} aria-hidden="true" />
        Start a new law firm
      </Button>
      <Button
        variant="ghost"
        size="lg"
        class="w-full justify-start text-start"
        onclick={onRedeemInvitation}
      >
        <TicketCheck size={18} aria-hidden="true" />
        I have an invitation code
      </Button>
    </div>

    <!--
      Below the choices, so the two controls stay together and nothing informational separates
      them. These are sentences, not disabled buttons: a control that cannot work is worse than an
      absent one, and worse still than a present one that says why it is inert.
    -->
    {#if unbuiltDoors.length > 0}
      <div class="flex flex-col gap-8 border-t border-border-subtle pt-16">
        <p class="text-sm font-medium text-text-default">Not yet possible</p>
        {#each unbuiltDoors as door (door.id)}
          <p class="text-sm text-text-muted">
            <span class="text-text-default">{door.label}.</span>
            {door.behaviour}
          </p>
        {/each}
      </div>
    {/if}
  {/snippet}
</AuthPanel>
