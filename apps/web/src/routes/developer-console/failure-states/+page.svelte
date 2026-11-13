<script lang="ts">
  /*
   * Failure states — every shape a failure takes in the product, on one scrollable surface.
   *
   * THIS IS THE REVIEW SURFACE FOR THE FAILURE SYSTEM, and it exists because these states cannot be
   * reached with real data: a step-up refusal, a lockout with a live countdown, a deploy-skew 404 and
   * a dead transport are each a moment you cannot ask a server to produce on demand. Everything below
   * renders the real components over real problem documents, so what a reviewer sees is exactly what
   * a member gets — the same guidance, the same remedy, the same trace behind Copy.
   *
   * Dev builds only, like the developer console itself — behind the import.meta.env.DEV gate.
   */
  import * as Select from "@magna-carta/design-system/select";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import FailureScreen from "$lib/diagnostics/failure-screen.svelte";
  import ReportDialog from "$lib/diagnostics/report-dialog.svelte";
  import type { Failure, Problem } from "$lib/api/problem.ts";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { DEVELOPER_CONSOLE_BACK } from "$lib/screen/screen-header.ts";

  // A fixed moment, so the surface reads the same on every visit and a screenshot of it is stable.
  const FAILED_AT = new Date("2026-08-31T21:07:44.318Z");

  function failure(request: string, problem: Problem | null): Failure {
    return { problem, request, failedAt: FAILED_AT };
  }

  interface FailureCase {
    name: string;
    note: string;
    failure: Failure;
    subject: string;
  }

  const cases: [FailureCase, ...FailureCase[]] = [
    {
      name: "A server fault",
      note: "Says nothing about the request, and carries the handle that makes it traceable.",
      subject: "The costs",
      failure: failure("GET /matters/mat_8QK2/costs", {
        status: 503,
        type: "https://api.magnacarta.esq/problems/upstream-unavailable",
        title: "The costs service is unavailable",
        detail: "The costs could not be read just now.",
        errorId: "error_7FQ2K9XW",
        correlationId: "correlation_01JB9K3M2ZT4",
      }),
    },
    {
      name: "Couldn't connect",
      note: "A different thing to a refusal, and the one the member's own connection often explains.",
      subject: "The costs",
      failure: failure("GET /matters/mat_8QK2/costs", null),
    },
    {
      name: "Deploy skew",
      note: "A 404 with no problem document behind it: no route answered, so the releases differ. Never an input fault.",
      subject: "This screen",
      failure: failure("GET /safe-browse/stream", { status: 404 }),
    },
    {
      name: "A record that is genuinely gone",
      note: "The same status, carrying a registered type and a handle. Not skew, and it says so.",
      subject: "This document",
      failure: failure("GET /documents/doc_44RT", {
        status: 404,
        type: "https://api.magnacarta.esq/problems/not-found",
        detail: "That document is no longer on the matter.",
        errorId: "error_1ABZ8KQ2",
      }),
    },
    {
      name: "Access can be requested",
      note: "A way THROUGH rather than a dead end — the field the app used to drop unread.",
      subject: "This matter",
      failure: failure("GET /matters/mat_8QK2", {
        status: 403,
        detail: "Ross v. Delacroix Holdings is restricted.",
        errorId: "error_4WJ8HN2A",
        requestAccess: true,
      }),
    },
    {
      name: "A fresh sign-in would work",
      note: "The other field the app used to drop. Nothing is broken; one control finishes the job.",
      subject: "This payment",
      failure: failure("POST /trust/disbursements", {
        status: 403,
        detail: "Moving client money needs a fresh sign-in. Nothing has left the trust ledger.",
        errorId: "error_9TG5RC0K",
        stepUpRequired: true,
      }),
    },
    {
      name: "A lockout with a budget",
      note: "Not a verdict on what was entered. The control counts down rather than failing again at once.",
      subject: "That invitation",
      failure: failure("POST /invitations/redemptions", {
        status: 429,
        errorId: "error_2M4XB1PD",
        attemptsRemaining: 2,
        retryAfterSeconds: 47,
      }),
    },
    {
      name: "A refusal with nothing to press",
      note: "Retrying would refuse identically, so no Retry renders — only a way to report it.",
      subject: "That cost",
      failure: failure("POST /costs/cost_88KQ/void", {
        status: 409,
        type: "https://api.magnacarta.esq/problems/conflict",
        title: "That cost could not be voided",
        detail: "It has already been claimed on a finalized bill. Raise a credit note instead.",
        errorId: "error_5PLM3XQ1",
      }),
    },
  ];

  let reportOpen = $state(false);
  // The Select carries the case NAME rather than an index: the value is what the trigger shows when
  // the listbox is closed, and "3" is not a case.
  let screenCaseName = $state(cases[0].name);
  const screenFailure = $derived<FailureCase>(
    cases.find((entry) => entry.name === screenCaseName) ?? cases[0],
  );
  const caseItems = $derived(cases.map((entry) => ({ value: entry.name, label: entry.name })));
</script>

<svelte:head>
  <title>Failure states · Magna Carta</title>
</svelte:head>

{#if import.meta.env.DEV}
  <div class="flex min-h-screen flex-col gap-32 bg-surface-default p-24 text-text-default">
    <header class="flex flex-col gap-4">
      <ScreenHeader title="Failure states" favoritable={false} back={DEVELOPER_CONSOLE_BACK} />
      <p class="max-w-prose text-sm text-text-muted">
        Every shape a failure takes, rendered by the real components over real problem documents.
        Copy works on every one of them; the trace it puts on the clipboard is the whole report.
      </p>
    </header>

    <section class="flex flex-col gap-16">
      <h2 class="text-lg font-semibold">Inline — an action failed, the screen still works</h2>
      {#each cases as entry (entry.name)}
        <div class="flex flex-col gap-8">
          <div class="flex flex-col gap-4">
            <p class="text-sm font-semibold">{entry.name}</p>
            <p class="max-w-prose text-xs text-text-muted">{entry.note}</p>
          </div>
          <FailureNotice
            failure={entry.failure}
            subject={entry.subject}
            onRetry={() => undefined}
            onReport={() => (reportOpen = true)}
            onStepUp={() => undefined}
            onRequestAccess={() => undefined}
          />
        </div>
      {/each}
    </section>

    <section class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <h2 class="text-lg font-semibold">Panel and screen scale</h2>
        <p class="max-w-prose text-xs text-text-muted">
          The same record at the two larger scales. Panel keeps the four facts and gets out of the
          way; screen owns the body, so it carries the whole trace and the ordered remedy.
        </p>
        <Select.Root type="single" items={caseItems} bind:value={screenCaseName}>
          <Select.Trigger class="max-w-sm" aria-label="Case">
            <Select.Value placeholder="Case" />
          </Select.Trigger>
          <Select.Content>
            {#each cases as entry (entry.name)}
              <Select.Item value={entry.name} label={entry.name} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      <div class="rounded-md border border-border-default p-16">
        <p class="pb-8 text-xs text-text-muted">Panel scale</p>
        <FailureScreen
          failure={screenFailure.failure}
          subject={screenFailure.subject}
          reassurance="The record itself is unaffected: nothing was changed by this failure."
          onRetry={() => undefined}
          onReport={() => (reportOpen = true)}
        />
      </div>

      <div class="rounded-md border border-border-default p-16">
        <p class="pb-8 text-xs text-text-muted">Screen scale</p>
        <FailureScreen
          failure={screenFailure.failure}
          scale="screen"
          subject={screenFailure.subject}
          reassurance="The record itself is unaffected: nothing was changed by this failure."
          onRetry={() => undefined}
          onReport={() => (reportOpen = true)}
        />
      </div>
    </section>

    <ReportDialog
      bind:open={reportOpen}
      errorId={screenFailure.failure.problem?.errorId ?? null}
      route={screenFailure.failure.request}
    />
  </div>
{:else}
  <p class="p-16 text-sm text-text-muted">
    The developer console is only available in development builds.
  </p>
{/if}
