<script lang="ts">
  /*
   * A firm's public intake form — the page an unidentified stranger opens from a link, fills in, and
   * sends.
   *
   * THIS IS THE ONLY SURFACE IN THE PRODUCT WITH NO SESSION AND NO FIRM CONTEXT. It lives outside the
   * (app) route group, so it draws no sidebar, no masthead and no navigation; a person who arrives
   * here is not a member and there is nowhere in this application for them to go.
   *
   * WHAT IT DELIBERATELY DOES NOT SAY. It never names the firm, never says whether the firm already
   * acts for somebody, never routes by subject matter, and never distinguishes a link that was
   * mistyped from a form that was closed. Every one of those would make the page a way of finding
   * out something about the firm, and the person who wants that is not the person the form is for.
   * The server holds the same line and holds it structurally; this page only has to avoid undoing it.
   *
   * WHAT IT TELLS THE VISITOR. That the enquiry arrived, and nothing more — not who will read it,
   * not when, not which team. The firm writes that sentence itself and the platform supplies a plain
   * one when it has not.
   */
  import { page } from "$app/state";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import * as Select from "@magna-carta/design-system/select";
  import * as Alert from "@magna-carta/design-system/alert";
  import HumanVerificationWidget from "$lib/human-verification/human-verification-widget.svelte";
  import {
    fieldKindAutocomplete,
    fieldKindInputMode,
    fieldKindIsLong,
  } from "$lib/intake-forms/field-kinds.ts";
  import type { IntakeFormFieldKind } from "$lib/intake-forms/intake-forms-api.ts";

  interface PublicField {
    readonly fieldId: string;
    readonly kind: IntakeFormFieldKind;
    readonly label: string;
    readonly helpText: string | null;
    readonly required: boolean;
    readonly options: string[] | null;
  }

  interface PublicForm {
    readonly title: string;
    readonly introduction: string | null;
    readonly humanVerificationSiteKey: string | null;
    readonly fields: readonly PublicField[];
  }

  const firmId = $derived(page.params.firmId ?? "");
  const publicToken = $derived(page.params.publicToken ?? "");

  type Stage = "reading" | "ready" | "unavailable" | "sending" | "sent";

  let stage = $state<Stage>("reading");
  let form = $state<PublicForm | null>(null);
  let answers = $state<Record<string, string>>({});
  let refusal = $state<string | null>(null);
  let confirmation = $state<string>("");
  let verificationToken = $state<string | null>(null);

  // The header the server reads a challenge solution from. A header rather than a body field so the
  // published request shape does not change when verification is switched on.
  const VERIFICATION_HEADER = "X-Human-Verification-Token";

  $effect(() => {
    const currentFirmId = firmId;
    const currentToken = publicToken;
    if (currentFirmId === "" || currentToken === "") return;
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(
          `/api/v1/public/intake-forms/${encodeURIComponent(currentFirmId)}/${encodeURIComponent(currentToken)}`,
          { headers: { accept: "application/json" } },
        );
        if (cancelled) return;
        if (!response.ok) {
          // Every unresolvable case is one case, on the server and here: a mistyped link, a form
          // that was never published, a form the firm has closed, and a link that was rotated away
          // are told apart by nobody.
          stage = "unavailable";
          return;
        }
        form = (await response.json()) as PublicForm;
        stage = "ready";
      } catch {
        if (!cancelled) stage = "unavailable";
      }
    })();

    return () => {
      cancelled = true;
    };
  });

  const canSend = $derived(
    stage === "ready" &&
      form !== null &&
      // A challenge that is present and unsolved holds the button. One that was never provisioned
      // does not exist, so it holds nothing.
      (form.humanVerificationSiteKey === null || verificationToken !== null),
  );

  function setAnswer(fieldId: string, value: string): void {
    answers = { ...answers, [fieldId]: value };
  }

  async function send(): Promise<void> {
    if (form === null || !canSend) return;
    refusal = null;
    stage = "sending";

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (verificationToken !== null) headers[VERIFICATION_HEADER] = verificationToken;

    try {
      const response = await fetch(
        `/api/v1/public/intake-forms/${encodeURIComponent(firmId)}/${encodeURIComponent(publicToken)}/submissions`,
        { method: "POST", headers, body: JSON.stringify({ answers }) },
      );

      if (response.ok) {
        const body = (await response.json()) as { message?: string };
        confirmation =
          body.message ?? "Thank you. We have received your enquiry and someone will be in touch.";
        stage = "sent";
        return;
      }

      // A refusal about what THEY typed is worth showing — it is the only thing on this path that is.
      // Anything else gets one neutral sentence, because the alternatives all describe the firm.
      const problem = (await response.json().catch(() => null)) as { detail?: string } | null;
      refusal =
        response.status === 422 && typeof problem?.detail === "string"
          ? problem.detail
          : "This could not be sent just now. Please try again in a moment.";
      // A spent challenge cannot be reused, so the visitor solves a fresh one before retrying.
      verificationToken = null;
      stage = "ready";
    } catch {
      refusal = "This could not be sent just now. Please try again in a moment.";
      verificationToken = null;
      stage = "ready";
    }
  }
</script>

<svelte:head>
  <title>{form?.title ?? "Enquiry"}</title>
  <!--
    Not indexed. A firm hands this link to the people it wants to reach it; a form discoverable by
    search is a form filled in by everybody else.
  -->
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="flex min-h-screen justify-center bg-surface-default px-24 py-48 text-text-default">
  <div class="flex w-full max-w-2xl flex-col gap-24">
    {#if stage === "reading"}
      <p class="text-sm text-text-muted">Loading…</p>
    {:else if stage === "unavailable"}
      <div class="flex flex-col gap-8">
        <h1 class="text-2xl font-semibold">This form is not available</h1>
        <p class="text-sm text-text-muted">
          The link may be out of date. If somebody sent it to you, ask them for a current one.
        </p>
      </div>
    {:else if stage === "sent"}
      <div class="flex flex-col gap-8">
        <h1 class="text-2xl font-semibold">Thank you</h1>
        <p class="text-sm text-text-muted">{confirmation}</p>
      </div>
    {:else if form !== null}
      <header class="flex flex-col gap-8">
        <h1 class="text-2xl font-semibold">{form.title}</h1>
        {#if form.introduction !== null}
          <p class="whitespace-pre-line text-sm text-text-muted">{form.introduction}</p>
        {/if}
      </header>

      <form
        class="flex flex-col gap-20"
        onsubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {#each form.fields as field (field.fieldId)}
          <div class="flex flex-col gap-6">
            <Label for={field.fieldId}>
              {field.label}{#if !field.required}<span class="ml-4 text-xs font-normal text-text-muted"
                  >Optional</span
                >{/if}
            </Label>

            {#if field.options !== null}
              <Select.Root
                type="single"
                value={answers[field.fieldId] ?? ""}
                onValueChange={(value) => setAnswer(field.fieldId, value ?? "")}
              >
                <Select.Trigger id={field.fieldId}>
                  {answers[field.fieldId] === undefined || answers[field.fieldId] === ""
                    ? field.label
                    : answers[field.fieldId]}
                </Select.Trigger>
                <Select.Content>
                  {#each field.options as option (option)}
                    <Select.Item value={option}>{option}</Select.Item>
                  {/each}
                </Select.Content>
              </Select.Root>
            {:else if fieldKindIsLong(field.kind)}
              <Textarea
                id={field.fieldId}
                rows={field.kind === "matter-description" ? 8 : 3}
                value={answers[field.fieldId] ?? ""}
                autocomplete={fieldKindAutocomplete(field.kind)}
                oninput={(event) => setAnswer(field.fieldId, event.currentTarget.value)}
              />
            {:else}
              <Input
                id={field.fieldId}
                value={answers[field.fieldId] ?? ""}
                autocomplete={fieldKindAutocomplete(field.kind)}
                inputmode={fieldKindInputMode(field.kind)}
                oninput={(event) => setAnswer(field.fieldId, event.currentTarget.value)}
              />
            {/if}

            <!--
              Help text sits UNDER the field and stays there. Never ghost text inside it: that
              disappears exactly when somebody starts typing, which is the moment an instruction is
              needed.
            -->
            {#if field.helpText !== null}
              <p class="text-xs text-text-muted">{field.helpText}</p>
            {/if}
          </div>
        {/each}

        {#if refusal !== null}
          <Alert.Root variant="danger">
            <Alert.Description>{refusal}</Alert.Description>
          </Alert.Root>
        {/if}

        <HumanVerificationWidget
          siteKey={form.humanVerificationSiteKey}
          onToken={(token) => (verificationToken = token)}
        />

        <div>
          <Button type="submit" disabled={!canSend || stage === "sending"}>
            {stage === "sending" ? "Sending" : "Send"}
          </Button>
        </div>
      </form>
    {/if}
  </div>
</div>
