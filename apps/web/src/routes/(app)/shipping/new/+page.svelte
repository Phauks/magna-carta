<script lang="ts">
  /*
   * New Shipment — recipient, package, options, rates, confirm, buy.
   *
   * A STEPPED WIZARD RATHER THAN ONE LONG FORM, because the middle of it is not a form at all: the
   * rates step is a live carrier call whose answers depend on everything above it, and the reader has
   * to choose from what comes back. A single page would have to either ask for everything and then
   * surprise them with prices, or re-quote on every keystroke.
   *
   * THE DRAFT IS CREATED BEFORE THE RATES ARE ASKED FOR, because that is what the contract requires —
   * rating is a read-through against a shipment the server is holding, not against a payload. It also
   * means a reader who abandons the wizard here leaves a draft behind rather than nothing, which is
   * the better of the two: a draft is visible in the register and costs nothing.
   *
   * POSTAGE AND THE SERVICE FEE ARE SEPARATE LINES AT THE CONFIRM STEP and are never summed into one
   * figure. A law firm bills postage on to a client, so the two have to be tellable apart on the way
   * in; the design fixed this when it rejected the carrier's own markup mechanism for exactly this
   * reason. The fee is zero until a fee policy exists, and the line says so rather than vanishing —
   * an absent line reads as "there is no fee", which is a promise nobody has made.
   */
  import { goto } from "$app/navigation";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import ProgressSteps from "@magna-carta/design-system/progress-steps";
  import type { ProgressStep } from "@magna-carta/design-system/progress-steps";
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Card from "@magna-carta/design-system/card";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import { WriteIntent } from "$lib/api/write-intent.ts";
  import {
    createShipmentDraft,
    purchaseLabel,
    rateShipment,
    type ShipmentRate,
  } from "$lib/shipping/shipping-api.ts";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { SHIPPING_BACK } from "$lib/screen/screen-header.ts";
  import { toast } from "@magna-carta/design-system/toast";
  import { formatMinorUnits } from "$lib/shipping/shipment-columns.ts";

  type StepName = "recipient" | "package" | "options" | "rates" | "confirm";
  const STEP_ORDER: readonly StepName[] = ["recipient", "package", "options", "rates", "confirm"];
  const STEP_LABELS: Record<StepName, string> = {
    recipient: "Recipient",
    package: "Package",
    options: "Options",
    rates: "Rates",
    confirm: "Confirm",
  };

  interface AddressDraft {
    name: string;
    company: string;
    street1: string;
    street2: string;
    city: string;
    state: string;
    zip: string;
    country: string;
    phone: string;
  }

  function blankAddress(): AddressDraft {
    return {
      name: "",
      company: "",
      street1: "",
      street2: "",
      city: "",
      state: "",
      zip: "",
      country: "US",
      phone: "",
    };
  }

  let step = $state<StepName>("recipient");
  let from = $state<AddressDraft>(blankAddress());
  let to = $state<AddressDraft>(blankAddress());
  let weightOz = $state("");
  let certifiedMail = $state(false);
  let returnReceipt = $state<"none" | "electronic" | "physical">("none");
  let signatureConfirmation = $state<"none" | "signature" | "adult">("none");

  let shipmentId = $state<string | null>(null);
  let remoteShipmentId = $state<string | null>(null);
  let rates = $state<readonly ShipmentRate[]>([]);
  let chosenRateId = $state<string | null>(null);
  let refusal = $state<string | null>(null);

  // One intent per act: the draft and the purchase are the two writes that must never happen twice
  // because a control was pressed twice, and each keeps its key across retries.
  const draftIntent = new WriteIntent();
  const purchaseIntent = new WriteIntent();

  let rating = $state(false);
  let buying = $state(false);
  const busy = $derived(rating || buying);
  const chosenRate = $derived(rates.find((rate) => rate.remoteId === chosenRateId) ?? null);

  // The service fee the platform adds. Zero until a fee policy exists — stated at the confirm step
  // rather than omitted, because an absent line reads as a promise that there will never be one.
  const SERVICE_FEE_MINOR = 0;

  const steps = $derived<ProgressStep[]>(
    STEP_ORDER.map((name) => ({
      label: STEP_LABELS[name],
      status:
        name === step
          ? "active"
          : STEP_ORDER.indexOf(name) < STEP_ORDER.indexOf(step)
            ? "done"
            : "pending",
    })),
  );

  function addressComplete(address: AddressDraft): boolean {
    return (
      address.name.trim() !== "" &&
      address.street1.trim() !== "" &&
      address.city.trim() !== "" &&
      address.state.trim() !== "" &&
      address.zip.trim() !== "" &&
      address.country.trim().length === 2
    );
  }

  const weightValid = $derived(Number(weightOz) > 0);
  const canLeaveRecipient = $derived(addressComplete(from) && addressComplete(to));

  function payloadAddress(address: AddressDraft) {
    return {
      name: address.name.trim(),
      company: address.company.trim() === "" ? null : address.company.trim(),
      street1: address.street1.trim(),
      street2: address.street2.trim() === "" ? null : address.street2.trim(),
      city: address.city.trim(),
      state: address.state.trim(),
      zip: address.zip.trim(),
      country: address.country.trim().toUpperCase(),
      phone: address.phone.trim() === "" ? null : address.phone.trim(),
    };
  }

  /* Creating the draft and asking for rates are one gesture for the reader and two acts for the
     server. A draft that was created but could not be rated is kept rather than discarded — it is in
     the register, and re-rating it is cheaper than rebuilding it. */
  async function goToRates(): Promise<void> {
    refusal = null;
    rating = true;
    try {
      if (shipmentId === null) {
        const created = await draftIntent.submit((key) =>
          createShipmentDraft(
            {
              from: payloadAddress(from),
              to: payloadAddress(to),
              parcel: { weightOz: Number(weightOz) },
              options: { certifiedMail, returnReceipt, signatureConfirmation },
            },
            key,
          ),
        );
        if (created.value.error !== undefined || created.value.data === undefined) {
          refusal = "The shipment could not be drafted.";
          return;
        }
        shipmentId = created.value.data.id;
      }
      step = "rates";
      const quoted = await rateShipment(shipmentId);
      if (quoted.error !== undefined || quoted.data === undefined) {
        refusal =
          "Rates could not be fetched. The draft has been kept — the postage account may not be connected.";
        return;
      }
      remoteShipmentId = quoted.data.remoteShipmentId;
      rates = quoted.data.rates;
      if (rates.length === 0) {
        refusal = "The carrier returned no services for this package and these addresses.";
      }
    } finally {
      rating = false;
    }
  }

  async function buy(): Promise<void> {
    const shipment = shipmentId;
    const remote = remoteShipmentId;
    const rateId = chosenRateId;
    if (shipment === null || remote === null || rateId === null) return;
    refusal = null;
    buying = true;
    try {
      const bought = await purchaseIntent.submit((key) =>
        purchaseLabel(
          shipment,
          { remoteShipmentId: remote, remoteRateId: rateId, serviceFeeMinor: SERVICE_FEE_MINOR },
          key,
        ),
      );
      if (bought.value.error !== undefined) {
        // Deliberately not "nothing was charged": a purchase that failed on the way back may have
        // succeeded at the carrier, and only the shipment's own status can say. The register is where
        // that answer lives.
        refusal = "The label could not be bought. Check the shipment in the register before retrying.";
        return;
      }
      toast.success("Label bought");
      await goto("/shipping");
    } finally {
      buying = false;
    }
  }
</script>

<svelte:head><title>New Shipment · Magna Carta</title></svelte:head>

<div class="flex h-full min-h-0 flex-col">
  <ScreenHeader title="New Shipment" back={SHIPPING_BACK} class="mb-24" />

  <ProgressSteps {steps} class="mb-24" />

  {#if refusal !== null}
    <Alert.Root variant="warning" class="mb-16">
      <Alert.Description>{refusal}</Alert.Description>
    </Alert.Root>
  {/if}

  <div class="max-w-2xl">
    {#if step === "recipient"}
      <Card.Root>
        <Card.Header><Card.Title>Who it is going to</Card.Title></Card.Header>
        <Card.Content class="flex flex-col gap-16">
          {#each [{ label: "From", address: from }, { label: "To", address: to }] as entry (entry.label)}
            <fieldset class="flex flex-col gap-8">
              <legend class="text-sm font-medium">{entry.label}</legend>
              <LabelledField label="Name">
                <Input bind:value={entry.address.name} />
              </LabelledField>
              <LabelledField label="Street">
                <Input bind:value={entry.address.street1} />
              </LabelledField>
              <div class="grid grid-cols-3 gap-8">
                <LabelledField label="City"><Input bind:value={entry.address.city} /></LabelledField>
                <LabelledField label="State">
                  <Input bind:value={entry.address.state} />
                </LabelledField>
                <LabelledField label="ZIP"><Input bind:value={entry.address.zip} /></LabelledField>
              </div>
            </fieldset>
          {/each}
        </Card.Content>
      </Card.Root>
      <div class="mt-16 flex justify-end">
        <Button disabled={!canLeaveRecipient} onclick={() => (step = "package")}>Continue</Button>
      </div>
    {:else if step === "package"}
      <Card.Root>
        <Card.Header><Card.Title>What is being sent</Card.Title></Card.Header>
        <Card.Content>
          <LabelledField label="Weight (ounces)">
            <Input bind:value={weightOz} inputmode="decimal" />
          </LabelledField>
        </Card.Content>
      </Card.Root>
      <div class="mt-16 flex justify-end gap-8">
        <Button variant="secondary" onclick={() => (step = "recipient")}>Back</Button>
        <Button disabled={!weightValid} onclick={() => (step = "options")}>Continue</Button>
      </div>
    {:else if step === "options"}
      <Card.Root>
        <Card.Header><Card.Title>How it is being sent</Card.Title></Card.Header>
        <Card.Content class="flex flex-col gap-16">
          <LabelledField label="Certified mail">
            <Checkbox bind:checked={certifiedMail} />
          </LabelledField>
          <LabelledField label="Return receipt">
            <RadioGroup.Root bind:value={returnReceipt}>
              <div class="flex items-center gap-8">
                <RadioGroup.Item value="none" id="shipment-return-receipt-none" />
                <Label for="shipment-return-receipt-none">None</Label>
              </div>
              <div class="flex items-center gap-8">
                <RadioGroup.Item value="electronic" id="shipment-return-receipt-electronic" />
                <Label for="shipment-return-receipt-electronic">Electronic</Label>
              </div>
              <div class="flex items-center gap-8">
                <RadioGroup.Item value="physical" id="shipment-return-receipt-physical" />
                <Label for="shipment-return-receipt-physical">Physical</Label>
              </div>
            </RadioGroup.Root>
          </LabelledField>
          <LabelledField label="Signature">
            <RadioGroup.Root bind:value={signatureConfirmation}>
              <div class="flex items-center gap-8">
                <RadioGroup.Item value="none" id="shipment-signature-none" />
                <Label for="shipment-signature-none">None</Label>
              </div>
              <div class="flex items-center gap-8">
                <RadioGroup.Item value="signature" id="shipment-signature-signature" />
                <Label for="shipment-signature-signature">Signature</Label>
              </div>
              <div class="flex items-center gap-8">
                <RadioGroup.Item value="adult" id="shipment-signature-adult" />
                <Label for="shipment-signature-adult">Adult signature</Label>
              </div>
            </RadioGroup.Root>
          </LabelledField>
        </Card.Content>
      </Card.Root>
      <div class="mt-16 flex justify-end gap-8">
        <Button variant="secondary" onclick={() => (step = "package")}>Back</Button>
        <Button disabled={busy} onclick={() => void goToRates()}>Get Rates</Button>
      </div>
    {:else if step === "rates"}
      <Card.Root>
        <Card.Header><Card.Title>Choose a service</Card.Title></Card.Header>
        <Card.Content class="flex flex-col gap-8">
          {#if rating}
            <p class="text-sm text-text-muted">Asking the carrier for rates.</p>
          {:else}
            {#each rates as rate (rate.remoteId)}
              <label class="flex items-center gap-12 rounded border p-12">
                <input type="radio" value={rate.remoteId} bind:group={chosenRateId} />
                <span class="flex-1">{rate.carrier} · {rate.service}</span>
                {#if rate.deliveryDays !== null}
                  <span class="text-sm text-text-muted">{rate.deliveryDays} days</span>
                {/if}
                <span class="tabular-nums"
                  >{formatMinorUnits(rate.amountMinor, rate.currency)}</span
                >
              </label>
            {/each}
          {/if}
        </Card.Content>
      </Card.Root>
      <div class="mt-16 flex justify-end gap-8">
        <Button variant="secondary" onclick={() => (step = "options")}>Back</Button>
        <Button disabled={chosenRateId === null} onclick={() => (step = "confirm")}>Continue</Button>
      </div>
    {:else}
      <Card.Root>
        <Card.Header><Card.Title>Confirm</Card.Title></Card.Header>
        <Card.Content class="flex flex-col gap-8">
          {#if chosenRate !== null}
            <div class="flex justify-between">
              <span>Postage · {chosenRate.carrier} {chosenRate.service}</span>
              <span class="tabular-nums"
                >{formatMinorUnits(chosenRate.amountMinor, chosenRate.currency)}</span
              >
            </div>
            <!-- Its own line, always. Postage is billed on to a client and the platform's fee may not
                 be, so the two are never summed into one figure on the way in. -->
            <div class="flex justify-between text-text-muted">
              <span>Service fee</span>
              <span class="tabular-nums">
                {SERVICE_FEE_MINOR === 0
                  ? "None charged yet"
                  : formatMinorUnits(SERVICE_FEE_MINOR, chosenRate.currency)}
              </span>
            </div>
          {/if}
        </Card.Content>
      </Card.Root>
      <div class="mt-16 flex justify-end gap-8">
        <Button variant="secondary" onclick={() => (step = "rates")}>Back</Button>
        <Button disabled={busy || chosenRate === null} onclick={() => void buy()}>
          {buying ? "Buying" : "Buy Label"}
        </Button>
      </div>
    {/if}
  </div>
</div>
