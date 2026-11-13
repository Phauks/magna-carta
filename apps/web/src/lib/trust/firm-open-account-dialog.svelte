<script lang="ts">
  /*
   * Opening a trust account.
   *
   * THE JURISDICTION IS THE OFFICE'S AND IS NEVER CHOSEN HERE. A trust account sits in the state of
   * the office that holds it, and the rules it answers to are that state's — so the form asks which
   * office and the jurisdiction follows. Offering a jurisdiction picker beside an office picker
   * would invite somebody to open an account in one state and declare it governed by another, which
   * is a compliance failure the platform would then have recorded on purpose.
   *
   * THE PLATFORM STORES FOUR DIGITS AND NEVER THE ACCOUNT NUMBER. What a member needs to tell two
   * accounts at one bank apart is the last four, and what a firm gains from storing the rest is
   * nothing at all set against what it would then have to protect. The field says so, and refuses
   * anything that is not exactly four digits here rather than sending it for the server to refuse.
   *
   * THE IDEMPOTENCY KEY IS MINTED WHEN THE PANEL OPENS, not when the commit is pressed. A retry
   * after a timeout has to be the SAME submission — two accounts at one bank with one name is a
   * real thing a firm can hold, so nothing downstream could tell a duplicate from a deliberate
   * pair. Minting on the opening gesture is what makes a retry a retry.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import Switch from "@magna-carta/design-system/switch";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import { viewerTimeZone } from "@magna-carta/civil-time/time-zone";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";
  import { OfficePicker, firmOffices } from "$lib/offices/index.ts";
  import { defaultEffectiveDate, fieldRefusal } from "./trust-write-requests.ts";
  import { openTrustAccount, type TrustAccountListing } from "./trust-api.ts";

  let {
    open = $bindable(false),
    onOpened,
  }: {
    open?: boolean;
    /** The account was opened. The screen re-reads the roster and selects it. */
    onOpened: (account: TrustAccountListing) => void;
  } = $props();

  const fieldPrefix = $props.id();

  let name = $state("");
  let locationId = $state<string | null>(null);
  let bankName = $state("");
  let lastFour = $state("");
  let iolta = $state(true);
  let openedOn = $state("");
  let failure = $state<StatedFailure | null>(null);

  /**
   * The submission this panel is making, minted on the gesture that opened it and reused on every
   * retry of it. A fresh key per press would make a retried open a second account.
   */
  let submissionKey = "";

  function reset(): void {
    name = "";
    locationId = null;
    bankName = "";
    lastFour = "";
    iolta = true;
    openedOn = defaultEffectiveDate(viewerTimeZone());
    failure = null;
    submissionKey = crypto.randomUUID();
  }

  /**
   * What the chosen office's jurisdiction adds to the field's own line, or nothing where no office
   * is chosen. Stated before the commit because an account bound to an office that records no
   * jurisdiction refuses every movement, and that is better learned here than at the first deposit.
   */
  const jurisdictionLine = $derived.by((): string => {
    const office = firmOffices.byId(locationId);
    if (office === undefined) return "";
    return office.jurisdiction === null
      ? " This office records no jurisdiction, so movements on the account are refused until it does."
      : ` This office records ${office.jurisdiction}.`;
  });

  /** Whether anything has been typed past what opening the panel filled in. */
  const started = $derived(
    name.trim() !== "" || locationId !== null || bankName.trim() !== "" || lastFour.trim() !== "",
  );

  const lastFourRefusal = $derived(
    lastFour.trim() === "" || /^\d{4}$/.test(lastFour.trim())
      ? undefined
      : "Enter exactly the last four digits of the account number, such as 4417.",
  );

  const commitRefusal = $derived.by((): string | undefined => {
    if (name.trim() === "") return "Name the account.";
    if (locationId === null) return "Choose the office that holds the account.";
    return lastFourRefusal;
  });

  /** The server's own words about one field it refused, shown under that field rather than above. */
  const problem = $derived(failure?.failure.problem ?? null);

  async function openAccount(): Promise<ActionOutcome> {
    if (locationId === null) return "refused";
    failure = null;
    const outcome = await openTrustAccount(
      fetch,
      {
        name: name.trim(),
        locationId,
        bankName: bankName.trim() === "" ? null : bankName.trim(),
        accountNumberLastFour: lastFour.trim() === "" ? null : lastFour.trim(),
        iolta,
        openedOn,
        currency: "USD",
      },
      submissionKey,
    );
    if (outcome.kind === "ok") {
      onOpened(outcome.value);
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "No account was opened.",
      "Couldn't connect. No account was opened, and trying again won't open a second one.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="New Account"
  commitLabel="Open Account"
  commitBusyLabel="Opening"
  {commitRefusal}
  unsavedChanges={started}
  onOpen={reset}
  onCommit={openAccount}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="No Account Was Opened"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <LabelledField
        label="Name"
        hint="What the firm calls this account."
        error={fieldRefusal(problem, "name")}
      >
        {#snippet children({ props })}
          <Input
            {...props}
            placeholder={placeholderOf("Name")}
            disabled={busy}
            bind:value={name}
          />
        {/snippet}
      </LabelledField>

      <div class="flex flex-col gap-8">
        <Label for="{fieldPrefix}-office">Office</Label>
        <OfficePicker
          inputId="{fieldPrefix}-office"
          bind:value={locationId}
          disabled={busy}
          title="The office that holds the account. Its jurisdiction governs every movement through the account."
        />
        <p class="mc-form-description">
          A trust account follows the state of the office that holds it.{jurisdictionLine}
        </p>
      </div>

      <div class="grid gap-12 sm:grid-cols-2">
        <LabelledField label="Bank" error={fieldRefusal(problem, "bankName")}>
          {#snippet children({ props })}
            <Input
              {...props}
              placeholder={placeholderOf("Bank")}
              disabled={busy}
              bind:value={bankName}
            />
          {/snippet}
        </LabelledField>

        <LabelledField
          label="Ending"
          hint="The last four digits. Only these are stored."
          error={lastFourRefusal ?? fieldRefusal(problem, "accountNumberLastFour")}
        >
          {#snippet children({ props })}
            <Input
              {...props}
              placeholder={placeholderOf("Ending")}
              inputmode="numeric"
              disabled={busy}
              bind:value={lastFour}
            />
          {/snippet}
        </LabelledField>
      </div>

      <div class="flex items-center justify-between gap-16">
        <div class="flex min-w-0 flex-col gap-4">
          <Label for="{fieldPrefix}-iolta">Pooled Interest-Bearing Account</Label>
          <p class="mc-form-description">
            An IOLTA account: interest on pooled client funds goes to the state's legal aid program, not to the firm or any one client.
          </p>
        </div>
        <Switch id="{fieldPrefix}-iolta" disabled={busy} bind:checked={iolta} />
      </div>

      <div class="flex flex-col gap-8">
        <DatePicker
          label="Opened On"
          value={civilDateValue(openedOn)}
          onValueChange={(next) => (openedOn = civilDateTextOrEmpty(next))}
          disabled={busy}
        />
        <p class="mc-form-description">The day the account was opened at the institution.</p>
      </div>

      <!-- Currency is stated rather than asked: the trust routes take United States dollars and
           nothing else, so a picker holding one option would be a question with one answer. -->
      <DefinitionList.Root>
        <DefinitionList.Row term="Currency">USD</DefinitionList.Row>
      </DefinitionList.Root>
    </div>
  {/snippet}
</ActionDialog>
