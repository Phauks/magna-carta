<script lang="ts">
  /*
   * What came back — the queue of enquiries one form has taken, and a member's decision about each.
   *
   * THE ANSWERS ARE SHOWN BESIDE THE QUESTIONS AS THEY WERE ASKED. Every submission names the version
   * of the form it arrived through, and that is what this screen reads — never what the form asks
   * today. A firm that reworded a question last month must not see last month's answers captioned
   * with this month's wording, because the difference between "were you injured" and "describe your
   * injuries" changes what an answer means.
   *
   * DECIDING CREATES NOTHING. Accepted, declined and spam record that a member looked and what they
   * concluded; no person, no organization, no matter and no intake follows from any of them. Turning
   * an accepted enquiry into a directory record is a separate act with its own preconditions, and it
   * is not built yet — so this screen says what it does rather than implying more.
   *
   * A DECISION CAN BE CHANGED, and the screen offers that plainly: an enquiry marked spam that turns
   * out to be real is exactly the mistake a queue produces, and a first decision that could not be
   * revised would make the firm's record a record of what it thought first.
   */
  import { page } from "$app/state";
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import Textarea from "@magna-carta/design-system/textarea";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { intakeFormBack } from "$lib/screen/screen-header.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { triageStateLabel } from "$lib/intake-forms/field-kinds.ts";
  import {
    listIntakeSubmissions,
    newWriteKey,
    readIntakeForm,
    readIntakeSubmission,
    triageIntakeSubmission,
    type IntakeFormDetail,
    type SubmissionDetail,
    type SubmissionSummary,
    type TriageState,
  } from "$lib/intake-forms/intake-forms-api.ts";

  const formId = $derived(page.params.formId ?? "");

  let form = $state<IntakeFormDetail | null>(null);
  let submissions = $state<SubmissionSummary[] | null>(null);
  let opened = $state<SubmissionDetail | null>(null);
  let failure = $state<StatedFailure | null>(null);
  let busy = $state(false);
  let note = $state("");

  async function read(): Promise<void> {
    if (formId === "") return;
    const [detail, queue] = await Promise.all([
      readIntakeForm(fetch, formId),
      listIntakeSubmissions(fetch, formId),
    ]);
    if (detail.kind === "ok") form = detail.value;
    if (queue.kind !== "ok") {
      failure = stated(queue.failure, "This form's submissions could not be read.");
      return;
    }
    submissions = queue.value.data;
    failure = null;
  }

  $effect(() => {
    void read();
  });

  async function open(submissionId: string): Promise<void> {
    const outcome = await readIntakeSubmission(fetch, formId, submissionId);
    if (outcome.kind !== "ok") {
      failure = stated(outcome.failure, "That submission could not be read.");
      return;
    }
    opened = outcome.value;
    note = outcome.value.triageNote ?? "";
  }

  async function decide(state: Exclude<TriageState, "new">): Promise<void> {
    if (opened === null) return;
    busy = true;
    const outcome = await triageIntakeSubmission(
      fetch,
      formId,
      opened.id,
      { state, note: note.trim() === "" ? null : note.trim() },
      newWriteKey(),
    );
    busy = false;
    if (outcome.kind !== "ok") {
      failure = stated(outcome.failure, "That decision could not be recorded.");
      return;
    }
    const reopened = opened.id;
    await read();
    await open(reopened);
  }

  const waiting = $derived(
    (submissions ?? []).filter((submission) => submission.triageState === "new").length,
  );
</script>

<svelte:head><title>Submissions · Magna Carta</title></svelte:head>

<ScreenHeader
  title="Submissions"
  back={intakeFormBack(formId, form?.name ?? "Form")}
/>

{#if failure !== null}
  <FailureNotice
    failure={failure.failure}
    title="Submissions Unavailable"
    fallback={failure.fallback}
    onRetry={() => void read()}
  />
{/if}

<LoadingRegion loading={submissions === null} label="Reading what this form has taken">
  {#if submissions !== null}
    {#if submissions.length === 0}
      <EmptyState title="Nothing Has Arrived">
        When somebody fills in this form, it waits here until a member reads it. Nothing a stranger
        sends becomes a person, a matter or an intake on its own.
      </EmptyState>
    {:else}
      <div class="flex max-w-5xl gap-24">
        <!-- The queue. -->
        <ul class="flex w-72 shrink-0 flex-col gap-4">
          {#each submissions as submission (submission.id)}
            <li>
              <button
                type="button"
                class="flex w-full flex-col gap-4 rounded border border-border-subtle p-8 text-left"
                aria-current={opened?.id === submission.id ? "true" : undefined}
                onclick={() => void open(submission.id)}
              >
                <span class="text-sm">{submission.submittedAt}</span>
                <Badge>{triageStateLabel(submission.triageState)}</Badge>
              </button>
            </li>
          {/each}
        </ul>

        <!-- The one that is open. -->
        <div class="flex min-w-0 flex-1 flex-col gap-16">
          {#if opened === null}
            <p class="text-sm text-text-muted">
              {waiting === 0
                ? "Nothing is waiting on a member. Choose an enquiry to read it."
                : `${waiting} waiting. Choose one to read it.`}
            </p>
          {:else}
            <div class="flex flex-col gap-12">
              {#each opened.answers as answer (answer.fieldId)}
                <div class="flex flex-col gap-4">
                  <!--
                    The question as it was asked, from this submission's own version of the form.
                  -->
                  <span class="text-xs font-medium text-text-muted">{answer.label}</span>
                  {#if answer.value === null}
                    <span class="text-sm text-text-muted">Not answered</span>
                  {:else}
                    <span class="whitespace-pre-line text-sm">{answer.value}</span>
                  {/if}
                </div>
              {/each}
            </div>

            <div class="flex flex-col gap-8 border-t border-border-subtle pt-16">
              {#if opened.triageState !== "new"}
                <Alert.Root variant="info">
                  <Alert.Description>
                    Recorded as {triageStateLabel(opened.triageState).toLowerCase()}. You can record
                    a different decision.
                  </Alert.Description>
                </Alert.Root>
              {/if}

              <Textarea
                rows={2}
                bind:value={note}
                disabled={busy}
                aria-label="A note about this decision"
              />
              <p class="text-xs text-text-muted">Optional. Only members see this.</p>

              <div class="flex gap-8">
                <Button disabled={busy} onclick={() => void decide("accepted")}>Accept</Button>
                <Button variant="secondary" disabled={busy} onclick={() => void decide("declined")}>
                  Decline
                </Button>
                <Button variant="secondary" disabled={busy} onclick={() => void decide("spam")}>
                  Spam
                </Button>
              </div>
              <p class="text-xs text-text-muted">
                Recording a decision does not create anything. Accepting says a member read this and
                wants to take it further; putting the person into the directory and starting an
                intake is still done from Intake.
              </p>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</LoadingRegion>
