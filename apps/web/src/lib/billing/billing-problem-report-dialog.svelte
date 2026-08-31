<script lang="ts">
  /*
   * Reporting a failed billing read, through the firm's own pipeline and nobody else's.
   *
   * WHAT TRAVELS IS NAMED BEFORE IT IS SENT. The report carries the reporter's words, the error
   * handle the failed read was given, the route, and the build. No invoice, no client name, no
   * amount, no matter content. Saying so on the dialog is not reassurance copy: it is the reason a
   * person is willing to send the report at all.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Dialog from "@magna-carta/design-system/dialog";
  import Button from "@magna-carta/design-system/button";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import { buildIdentityLine } from "$lib/build-identity.ts";
  import { reportBillingProblem } from "./billing-api.ts";

  let {
    open = $bindable(false),
    errorId = null,
    route,
  }: {
    open?: boolean;
    errorId?: string | null;
    /** Where the failure happened, as the app addresses it. */
    route: string;
  } = $props();

  const fieldPrefix = $props.id();

  let description = $state("");
  let sending = $state(false);
  let failure = $state<string | null>(null);
  let sentIdentifier = $state<string | null>(null);

  $effect(() => {
    if (!open) return;
    description = "";
    failure = null;
    sentIdentifier = null;
  });

  /*
   * Only a handle the contract recognises is sent. An identifier in some other shape would be
   * refused by the route and lose the whole report with it, so it travels in the words instead.
   */
  const reportableErrorIds = $derived(
    errorId !== null && errorId.startsWith("error_") ? [errorId] : [],
  );

  const refusal = $derived(
    description.trim() === "" ? "Say what happened: the report is read by a person" : null,
  );

  async function send(): Promise<void> {
    if (refusal !== null || sending) return;
    sending = true;
    failure = null;
    const words =
      errorId === null || reportableErrorIds.length > 0
        ? description.trim()
        : `${description.trim()}\n\nError ID as shown: ${errorId}`;
    const outcome = await reportBillingProblem(fetch, {
      description: words,
      errorIds: reportableErrorIds,
      route,
      appVersion: buildIdentityLine(),
    });
    sending = false;
    if (outcome.kind === "ok") {
      sentIdentifier = outcome.value.id;
      return;
    }
    failure =
      outcome.kind === "transport"
        ? "Nothing answered. The report was not sent."
        : (outcome.problem.detail ?? "The report was not sent.");
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content showClose={false}>
    <Dialog.Title>Report a Problem</Dialog.Title>
    <Dialog.Description>
      This goes to the firm&rsquo;s own reporting pipeline, not to a third party.
    </Dialog.Description>

    {#if failure !== null}
      <Alert.Root variant="danger">
        <Alert.Title>Not Sent</Alert.Title>
        <Alert.Description>{failure}</Alert.Description>
      </Alert.Root>
    {/if}

    {#if sentIdentifier !== null}
      <Alert.Root variant="success">
        <Alert.Title>Report Sent</Alert.Title>
        <Alert.Description>
          It was recorded as {sentIdentifier}. Quoting that reference gets support to it directly.
        </Alert.Description>
      </Alert.Root>
    {:else}
      <div class="flex flex-col gap-8">
        <Label for="{fieldPrefix}-what">What Happened</Label>
        <Textarea
          id="{fieldPrefix}-what"
          rows={3}
          placeholder={placeholderOf("What Happened")}
          disabled={sending}
          bind:value={description}
        />
        <p class="text-xs text-text-muted">Say what you were doing when it failed.</p>
        <p class="text-xs text-text-muted">
          Sent with the report: {errorId === null
            ? "the failing request"
            : `the Error ID (${errorId}), the failing request`}, the time, and your app version. No
          invoice, client name, amount or matter content leaves the firm.
        </p>
      </div>
    {/if}

    <div class="flex justify-end gap-8">
      <Button variant="secondary" disabled={sending} onclick={() => (open = false)}>
        {sentIdentifier === null ? "Cancel" : "Close"}
      </Button>
      {#if sentIdentifier === null}
        <Button
          disabled={refusal !== null || sending}
          title={refusal ?? "Send the report through the firm's own reporting pipeline"}
          onclick={() => void send()}
        >
          Send Report
        </Button>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
