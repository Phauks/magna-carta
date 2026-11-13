<script lang="ts">
  /*
   * Reporting a problem, through the firm's own pipeline and nobody else's.
   *
   * WHAT TRAVELS IS NAMED BEFORE IT IS SENT. The report carries the reporter's words, the error
   * handle the failure was given, the route, the build and the breadcrumb trail — shapes, never
   * values. No document, no file name, no client name, no matter content. Saying so on the dialog is
   * not reassurance copy: it is the reason a person is willing to send the report at all.
   *
   * ONE DIALOG. This existed twice — once in costs, once in billing — and the copies had already
   * drifted: one offered the screenshot affordance and one did not, and one sent the build from the
   * dialog while the other sent it from its own module. Reaching it also required having first found
   * a broken panel in one of those two areas, which during a real incident is the difference between
   * one usable signal per affected member and none.
   *
   * A sent report is a DONE panel: it stays open to show the reference the report was recorded
   * under, with nothing left to ask, and leaves through Close.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import Textarea from "@magna-carta/design-system/textarea";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import { SoonAffordance } from "@magna-carta/design-system/maturity";
  import { isReportableErrorId, reportProblem } from "./report.ts";
  import { breadcrumbs } from "./breadcrumbs.ts";

  let {
    open = $bindable(false),
    errorId = null,
    route,
    screenshotReason,
  }: {
    open?: boolean;
    /** The correlation handle the failure was given, where the server issued one. */
    errorId?: string | null;
    /** Where the failure happened, as the app addresses it. */
    route: string;
    /**
     * Why screenshot capture is not available yet, in one honest line. Omitted where the caller has
     * no such reason to state, in which case the affordance is not shown at all rather than shown
     * with nothing behind it.
     */
    screenshotReason?: string;
  } = $props();

  const fieldPrefix = $props.id();

  let description = $state("");
  let failure = $state<string | null>(null);
  let sentIdentifier = $state<string | null>(null);

  function reset(): void {
    description = "";
    failure = null;
    sentIdentifier = null;
  }

  /*
   * Only a handle the contract recognises is sent. An identifier in some other shape would be
   * refused by the route and lose the whole report with it, so it travels in the words instead.
   */
  const reportableErrorIds = $derived(isReportableErrorId(errorId) ? [errorId as string] : []);
  const crumbCount = $derived(breadcrumbs().length);

  const refusal = $derived(
    description.trim() === "" ? "Say what happened: the report is read by a person." : undefined,
  );

  const travelling = $derived(
    `Sent with the report: ${
      errorId === null ? "the failing request" : `the Error ID (${errorId}), the failing request`
    }, the time, your app version${
      crumbCount > 0 ? `, and the last ${crumbCount} things you did in the app` : ""
    }.`,
  );

  async function send(): Promise<ActionOutcome> {
    if (refusal !== undefined) return "refused";
    failure = null;
    const words =
      errorId === null || reportableErrorIds.length > 0
        ? description.trim()
        : `${description.trim()}\n\nError ID as shown: ${errorId}`;
    const outcome = await reportProblem(fetch, {
      description: words,
      errorIds: reportableErrorIds,
      route,
    });
    if (outcome.kind === "ok") {
      sentIdentifier = outcome.value.id;
      return "done";
    }
    failure =
      outcome.kind === "transport"
        ? "Couldn't connect. The report wasn't sent."
        : (outcome.problem.detail ?? "The report was not sent.");
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Report a Problem"
  commitLabel="Send Report"
  commitBusyLabel="Sending"
  commitRefusal={refusal}
  unsavedChanges={description.trim() !== ""}
  onOpen={reset}
  onCommit={send}
>
  {#snippet fields({ busy, done })}
    {#if done && sentIdentifier !== null}
      <Alert.Root variant="success">
        <Alert.Title>Report Sent</Alert.Title>
        <Alert.Description>
          It was recorded as {sentIdentifier}. Quoting that reference gets support to it directly.
        </Alert.Description>
      </Alert.Root>
    {:else}
      <LabelledField label="What Happened" hint="Say what you were doing when it failed.">
        {#snippet children({ props })}
          <Textarea
            {...props}
            rows={3}
            placeholder={placeholderOf("What Happened")}
            disabled={busy}
            bind:value={description}
          />
        {/snippet}
      </LabelledField>
      <p class="text-xs text-text-muted">{travelling}</p>

      {#if screenshotReason !== undefined}
        <SoonAffordance reason={screenshotReason} reasonPlacement="line">
          {#snippet control(soon)}
            <span class="flex items-center gap-8">
              <Checkbox id="{fieldPrefix}-shot" {...soon} />
              <Label for="{fieldPrefix}-shot">Include a screenshot of this screen</Label>
            </span>
          {/snippet}
        </SoonAffordance>
      {/if}
      <p class="text-xs text-text-muted">
        No document, file name, client name or matter content leaves the firm.
      </p>
    {/if}
  {/snippet}

  {#snippet notice()}
    {#if failure !== null}
      <Alert.Root variant="danger">
        <Alert.Title>Not Sent</Alert.Title>
        <Alert.Description>{failure}</Alert.Description>
      </Alert.Root>
    {/if}
  {/snippet}
</ActionDialog>
