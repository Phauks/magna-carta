<script lang="ts">
  /*
   * Attorney License Lookup — the official register where a lawyer's standing is verified, per state.
   *
   * Bar admission is per state and every state publishes its own register, so the question a person
   * arrives with is not "is this lawyer in good standing" but "which of fifty-one pages answers
   * that, and where is it". This screen answers only the second, and hands over the live page.
   *
   * IT DELIBERATELY VERIFIES NOTHING ITSELF. The registers are the authority. Querying them here and
   * showing the answer would mean showing a copy, and a suspension is precisely the fact that
   * changes after you look, so a stale copy is worse than none. Nothing is fetched, nothing is
   * stored, and the reader reads the register rather than this screen's account of it.
   *
   * The choice is the run control and sits at the content's reading edge below the masthead, with
   * no info prose around it (docs/conventions/design-corrections.md, "No info lines"). The register
   * card is furniture: its frame renders from page load holding its rows empty, so choosing a state
   * fills a shape already on the screen instead of making one appear. There is no loading state
   * because there is no request: the registry is in the bundle and the answer is synchronous.
   */
  import Button from "@magna-carta/design-system/button";
  import * as Card from "@magna-carta/design-system/card";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import { opensBeside } from "$lib/navigation/open-beside.ts";
  import * as Alert from "@magna-carta/design-system/alert";
  import {
    licensingStateChoices,
    registerForState,
    registerIsSecure,
  } from "$lib/tools/attorney-license/attorney-license.ts";

  const states = licensingStateChoices();

  let stateFips = $state("");
  const register = $derived(registerForState(stateFips));
  const chosen = $derived(states.find((option) => option.value === stateFips) ?? null);
  // Two registers are served over plain HTTP. Said before the link rather than after it: on such a
  // page the lawyer being asked about, and the answer, are readable by anything on the path.
  const insecure = $derived(register !== null && !registerIsSecure(register));
</script>

<svelte:head><title>Attorney License Lookup · Magna Carta</title></svelte:head>

<ScreenHeader title="Attorney License Lookup" back="tools" class="mb-24" />

<div class="mb-16 w-3xs">
  <LabelledField label="State" id="attorney-license-state">
    {#snippet children({ props })}
      <ChoicePicker
        inputId={props.id}
        label="State"
        options={states}
        bind:value={stateFips}
      />
    {/snippet}
  </LabelledField>
</div>

<section>
  <FieldLabel as="h2" class="mb-16 border-b border-border-strong pb-8">Register</FieldLabel>

  <Card.Root>
    <Card.Content>
      <div class="flex flex-col gap-16">
        <div class="flex flex-col gap-4">
          <FieldLabel>Authority</FieldLabel>
          <p class="text-body">
            {#if register === null}
              <span class="text-muted-foreground">Choose a state.</span>
            {:else}
              {register.name}
            {/if}
          </p>
        </div>

        <div class="flex flex-col gap-4">
          <FieldLabel>Jurisdiction</FieldLabel>
          <p class="text-body">
            {#if chosen === null}
              <span class="text-muted-foreground">Choose a state.</span>
            {:else}
              {chosen.label} ({chosen.aside})
            {/if}
          </p>
        </div>

        {#if insecure}
          <Alert.Root variant="warning">
            <Alert.Title>This Register Is Not Encrypted</Alert.Title>
            <Alert.Description>
              This state publishes its register over plain HTTP. Anything you search for there, and
              what it returns, can be read by others on the network. The register is still the
              authority on a lawyer's standing.
            </Alert.Description>
          </Alert.Root>
        {/if}

        {#if register !== null}
          <div>
            <Button variant="primary" href={register.searchUrl} {...opensBeside("external")}>
              <ExternalLink aria-hidden="true" />
              Open the Register
            </Button>
          </div>
        {/if}
      </div>
    </Card.Content>
  </Card.Root>
</section>
