<script lang="ts">
  /*
   * FORMS — what a firm asks people who are not its clients yet, and what came back.
   *
   * WHAT A FORM IS HERE. Not a document and not a template: those are the firm's own paper and live
   * in the documents cluster. A form on this screen is a page on the open internet that a stranger
   * fills in — the firm publishes it, hands out its link, and reads what arrives. The word was on the
   * document-automation surface until the owner ruled otherwise on 2026-09-07
   * (docs/conventions/design-corrections.md).
   *
   * THE COLUMNS ARE THE FIRM'S OWN FACTS. What the form is called, whether it is on the internet,
   * whether it has changes nobody has published, and how many enquiries are waiting on somebody. The
   * one number that matters day to day is the last: it is the reason a member opens this screen.
   *
   * NOTHING HERE SAYS ANYTHING ABOUT WHO SENT AN ENQUIRY. A count of what is waiting is a fact about
   * the firm's own queue; who is in it is on the form's own submissions screen, where a member has
   * gone looking.
   */
  import { goto } from "$app/navigation";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import CreateControl from "@magna-carta/design-system/create-control";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import NewIntakeFormDialog from "$lib/intake-forms/new-intake-form-dialog.svelte";
  import {
    listIntakeForms,
    MANAGE_INTAKE_FORMS_PERMISSION,
    type IntakeFormSummary,
  } from "$lib/intake-forms/intake-forms-api.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";

  let forms = $state<IntakeFormSummary[] | null>(null);
  let failure = $state<StatedFailure | null>(null);
  let session = $state<SessionBootstrap | null>(null);
  let dialogOpen = $state(false);

  const mayManage = $derived(
    session?.permissions?.includes(MANAGE_INTAKE_FORMS_PERMISSION) ?? false,
  );

  async function read(): Promise<void> {
    const outcome = await listIntakeForms(fetch);
    if (outcome.kind === "ok") {
      forms = outcome.value.data;
      failure = null;
      return;
    }
    failure = stated(outcome.failure, "The firm's forms could not be read.");
  }

  $effect(() => {
    void (async () => {
      const bootstrap = await readSession(fetch);
      if (bootstrap.kind === "ok") session = bootstrap.value;
      await read();
    })();
  });

  function statusLabel(form: IntakeFormSummary): string {
    switch (form.status) {
      case "published":
        return "Live";
      case "closed":
        return "Closed";
      default:
        return "Draft";
    }
  }

  const grid = DataTable.createDataTableGrid<IntakeFormSummary>({
    columns: () => [
      { id: "name", label: "Form", anchored: true, value: (row) => row.name },
      {
        id: "status",
        label: "Status",
        filter: "set",
        value: (row) => statusLabel(row),
        filterValues: ["Live", "Draft", "Closed"],
      },
      {
        id: "waiting",
        label: "Waiting",
        // The count a member came for. Zero prints as zero rather than as a dash: "nothing is
        // waiting" is an answer, and an empty cell reads as "we did not look".
        value: (row) => String(row.waitingSubmissions),
      },
      {
        id: "unpublished",
        label: "Unpublished Changes",
        value: (row) => (row.hasUnpublishedChanges ? "Yes" : "No"),
      },
      { id: "updated", label: "Last Changed", value: (row) => row.updatedAt },
    ],
    rows: () => forms ?? [],
    rowKey: (row) => row.id,
    itemNoun: { singular: "form", plural: "forms" },
    onActivate: (row) => void goto(`/forms/${row.id}`),
  });
</script>

<svelte:head><title>Forms · Magna Carta</title></svelte:head>

<ScreenHeader title="Forms">
  {#snippet actions()}
    <CreateControl
      noun="Form"
      title="Write a form for people who are not clients yet, and publish it when it is ready."
      refusal={mayManage
        ? undefined
        : permissionRefusal("Authoring a form", MANAGE_INTAKE_FORMS_PERMISSION)}
      onpress={() => (dialogOpen = true)}
    />
  {/snippet}
</ScreenHeader>

{#if failure !== null}
  <FailureNotice
    failure={failure.failure}
    title="Forms Unavailable"
    fallback={failure.fallback}
    onRetry={() => void read()}
  />
{:else}
  <DataTable.Grid
    {grid}
    class="h-full min-h-0"
    caption="The firm's public intake forms"
    loading={forms === null}
  >
    {#snippet empty()}
      <EmptyState title="No Forms Yet">
        A form is a page on the internet that somebody who is not yet a client fills in — what
        happened to them, and how to reach them. You write the questions, publish it, and hand out
        the link; what arrives waits here until a member reads it. Nothing a stranger sends becomes
        a person, a matter or an intake on its own.
        {#if !mayManage}
          {permissionRefusal("Authoring a form", MANAGE_INTAKE_FORMS_PERMISSION)}
        {/if}
      </EmptyState>
    {/snippet}
  </DataTable.Grid>
{/if}

<NewIntakeFormDialog
  bind:open={dialogOpen}
  onCreated={(formId) => {
    dialogOpen = false;
    void goto(`/forms/${formId}`);
  }}
/>
