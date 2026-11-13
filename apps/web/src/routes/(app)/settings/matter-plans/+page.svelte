<script lang="ts">
  /*
   * Settings · Matter Plans — the firm's own account of what a kind of matter takes.
   *
   * A plan PROPOSES tasks; it never writes them. That is the whole shape of the feature and this
   * screen has to say so, because somebody authoring "14 days after the matter opens" reasonably
   * expects the platform to enforce it. It does not: it offers, a person reviews, and what they keep
   * becomes tasks on that one matter.
   *
   * TWO THINGS THIS SCREEN SAYS OUT LOUD, because getting them wrong is how a plan does harm:
   *
   *   - THE DAYS ARE PLAIN CALENDAR DAYS. No weekend skip, no court holidays, no service-method
   *     rule. That is deliberate — deriving a legal deadline from a rule is an engine this platform
   *     does not have — and it means a step can land on a Sunday. The person reviewing the plan on a
   *     matter is the one who moves it.
   *   - A STEP NAMES A ROLE, NOT A PERSON. Roles are resolved against each matter's own team when
   *     the plan is proposed, so one plan works for every matter; a plan naming a person would be
   *     wrong the moment their matters moved.
   *
   * The platform ships no plans. This list starts empty in every firm, on purpose.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { SAMPLE_SENTENCE } from "@magna-carta/design-system/loading-fixtures";
  import Textarea from "@magna-carta/design-system/textarea";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Plus from "@lucide/svelte/icons/plus";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    addPlanStep,
    createPlan,
    describeAnchor,
    listPlans,
    readPlan,
    removePlanStep,
    setPlanActive,
    type MatterPlan,
    type PlanDueAnchor,
  } from "$lib/matters/matter-plans-api.ts";
  import { PRIORITY_LABELS, TASK_PRIORITIES, newWriteKey, type TaskPriority } from "$lib/matters/tasks-api.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";

  let session = $state<SessionBootstrap | null>(null);
  let plans = $state<readonly MatterPlan[] | null>(null);
  let openPlan = $state<MatterPlan | null>(null);
  let readFailure = $state<StatedFailure | null>(null);
  let writeFailure = $state<StatedFailure | null>(null);
  let saving = $state(false);
  /** True while a list already on screen is being read again after a write. */
  let rereading = $state(false);

  // Authoring a plan is its own permission: what the work IS, rather than doing it. A member without
  // it reads the firm's plans and changes none of them, so the controls are absent rather than
  // present-and-refusing.
  const canManage = $derived(session === null || session.permissions.includes("tasks:managePlans"));

  let composing = $state(false);
  let draftName = $state("");
  let draftDescription = $state("");

  let composingStep = $state(false);
  let stepTitle = $state("");
  let stepBody = $state("");
  let stepPriority = $state<TaskPriority>("normal");
  let stepRole = $state("");
  let stepAnchor = $state<PlanDueAnchor>("none");
  const DUE_ANCHOR_CHOICES: readonly { value: PlanDueAnchor; label: string }[] = [
    { value: "none", label: "No date" },
    { value: "matter_opened", label: "Days after the matter opens" },
  ];
  const PRIORITY_CHOICES = TASK_PRIORITIES.map((priority) => ({
    value: priority,
    label: PRIORITY_LABELS[priority],
  }));
  let stepOffset = $state("");

  $effect(() => {
    void readSession(fetch).then((outcome) => {
      session = outcome.kind === "ok" ? outcome.value : null;
    });
    void refresh();
  });

  async function refresh(): Promise<void> {
    rereading = plans !== null;
    const outcome = await listPlans(fetch, true);
    rereading = false;
    if (outcome.kind !== "ok") {
      // The rows already on screen were read and stand; a failed first read leaves nothing, and
      // the region renders the notice in place of the shape.
      readFailure = stated(outcome.failure, "The firm's matter plans could not be read.");
      return;
    }
    readFailure = null;
    plans = outcome.value.data;
    // Keep the open plan in step with the list, so a step added a moment ago is on screen.
    const current = openPlan;
    if (current !== null) await openDetail(current.id);
  }

  async function openDetail(planId: string): Promise<void> {
    const outcome = await readPlan(fetch, planId);
    openPlan = outcome.kind === "ok" ? outcome.value : null;
    if (outcome.kind !== "ok") {
      writeFailure = stated(outcome.failure, "That plan could not be read.");
    }
  }

  async function runWrite(
    call: () => Promise<{ kind: string } & Record<string, unknown>>,
    whenSilent: string,
    after?: () => void,
  ): Promise<void> {
    if (saving) return;
    saving = true;
    writeFailure = null;
    const outcome = (await call()) as
      | { kind: "ok" }
      | { kind: "transport" | "problem"; failure: Parameters<typeof stated>[0] };
    saving = false;
    if (outcome.kind === "ok") {
      after?.();
      await refresh();
      return;
    }
    writeFailure = stated(outcome.failure, whenSilent);
  }

  const offsetNumber = $derived(stepOffset.trim() === "" ? null : Number(stepOffset));

  // The shape drawn while the list is read: two plans in the list's own row, sample words only. The
  // description is the sample vocabulary's sentence; a plan's name is the firm's own kind of word,
  // which it does not carry.
  const PLAN_FIXTURE = [
    { name: "Personal injury, plaintiff", description: SAMPLE_SENTENCE },
    { name: "Residential closing", description: SAMPLE_SENTENCE },
  ];
</script>

<svelte:head>
  <title>Matter Plans · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId="matter-plans"
  title="Matter Plans"
  posture={canManage ? "draft" : "readOnly"}
/>

<SettingsScrollRegion>
  <SettingsDescription>What a kind of matter takes, as a list the firm offers when one is opened.</SettingsDescription>

    <Alert.Root variant="info">
      <Alert.Title>A Plan Offers, It Does Not Impose</Alert.Title>
      <Alert.Description>
        When a matter of the right type opens, its plan's tasks are offered on the matter's Tasks page. Nothing is added until someone accepts them. Dates count calendar days, so check for weekends.
      </Alert.Description>
    </Alert.Root>

    {#if writeFailure !== null}
      <FailureNotice
        failure={writeFailure.failure}
        title="Nothing Changed"
        fallback={writeFailure.fallback}
      />
    {/if}

    <div class="flex items-center justify-between gap-16 border-b border-border-strong pb-8">
      <FieldLabel as="h2">
        The Firm's Plans
      </FieldLabel>
      {#if composing}
        <Button variant="secondary" disabled={saving} onclick={() => (composing = false)}>Cancel</Button>
      {:else}
        <Button variant="secondary" disabled={!canManage} onclick={() => (composing = true)}>
          <Plus aria-hidden="true" />
          New Plan
        </Button>
      {/if}
    </div>

    {#if composing}
      <div class="flex flex-col gap-12 rounded-md border border-border-strong p-16">
        <div class="flex flex-col gap-4">
          <Label for="plan-name">Name</Label>
          <Input id="plan-name" bind:value={draftName} disabled={saving} />
        </div>
        <div class="flex flex-col gap-4">
          <Label for="plan-description">What this plan is for</Label>
          <Textarea id="plan-description" bind:value={draftDescription} rows={2} disabled={saving} />
        </div>
        <div class="flex justify-end">
          <Button
            disabled={saving || draftName.trim().length === 0}
            onclick={() =>
              runWrite(
                () =>
                  createPlan(
                    fetch,
                    {
                      name: draftName.trim(),
                      description: draftDescription.trim() === "" ? null : draftDescription.trim(),
                      // Bound to no matter type, so it is offered on every matter. Narrowing it to
                      // one type is an edit once the type picker is on this screen.
                      matterTypeId: null,
                    },
                    newWriteKey(),
                  ),
                "The plan was not created.",
                () => {
                  composing = false;
                  draftName = "";
                  draftDescription = "";
                },
              )}
          >
            Create Plan
          </Button>
        </div>
      </div>
    {/if}

    <!-- A failed first read settles to the notice with Retry; a failed re-read after a write keeps
         the rows on screen and says so above them. -->
    <LoadingRegion
      loading={plans === null}
      failed={readFailure !== null && plans === null}
      refreshing={rereading}
      empty={plans !== null && plans.length === 0}
      label="Reading the firm's plans"
      onRetry={() => void refresh()}
      class="flex flex-col"
    >
      {#snippet failure()}
        {#if readFailure !== null}
          <FailureNotice
            failure={readFailure.failure}
            title="Plans Unavailable"
            fallback={readFailure.fallback}
            onRetry={() => void refresh()}
          />
        {/if}
      {/snippet}
      {#snippet emptyState()}
        <EmptyState title="No plans yet">
          A plan lists the tasks a type of matter needs, such as calls, letters and filings. It's offered each time a matter of that type opens.
        </EmptyState>
      {/snippet}
      {#snippet fixture()}
        <ul class="flex flex-col gap-8">
          {#each PLAN_FIXTURE as plan (plan.name)}
            <li class="flex flex-col gap-8 rounded-md border border-border-strong p-16">
              <div class="flex flex-wrap items-start justify-between gap-8">
                <div class="flex flex-col gap-2">
                  <div class="flex items-center gap-8">
                    <span>{plan.name}</span>
                  </div>
                  <p class="text-xs text-text-muted">{plan.description}</p>
                </div>
                <div class="flex gap-4">
                  <Button variant="secondary">Steps</Button>
                </div>
              </div>
            </li>
          {/each}
        </ul>
      {/snippet}
      {@const shown = plans ?? []}
      {#if readFailure !== null}
        <FailureNotice
          failure={readFailure.failure}
          title="The Plans Were Not Re-read"
          fallback={readFailure.fallback}
          onRetry={() => void refresh()}
        />
      {/if}
      {#if shown.length > 0}
        <ul class="flex flex-col gap-8">
          {#each shown as plan (plan.id)}
            <li class="flex flex-col gap-8 rounded-md border border-border-strong p-16">
              <div class="flex flex-wrap items-start justify-between gap-8">
                <div class="flex flex-col gap-2">
                  <div class="flex items-center gap-8">
                    <span class={plan.active ? "" : "text-text-muted"}>{plan.name}</span>
                    {#if !plan.active}
                      <Badge variant="neutral">Not offered</Badge>
                    {/if}
                  </div>
                  {#if plan.description !== null}
                    <p class="text-xs text-text-muted">{plan.description}</p>
                  {/if}
                </div>
                <div class="flex gap-4">
                  <Button
                    variant="secondary"
                    disabled={saving}
                    onclick={() => (openPlan?.id === plan.id ? (openPlan = null) : openDetail(plan.id))}
                  >
                    {openPlan?.id === plan.id ? "Close" : "Steps"}
                  </Button>
                  {#if canManage}
                    <Button
                      variant="ghost"
                      disabled={saving}
                      title={plan.active ? "Stop offering this plan" : "Offer this plan again"}
                      onclick={() =>
                        runWrite(
                          () => setPlanActive(fetch, plan.id, !plan.active, newWriteKey()),
                          "The plan's availability was not changed.",
                        )}
                    >
                      {plan.active ? "Stop Offering" : "Offer Again"}
                    </Button>
                  {/if}
                </div>
              </div>

              {#if openPlan?.id === plan.id}
                <div class="flex flex-col gap-8 border-t border-border-subtle pt-8">
                  {#if (openPlan.tasks ?? []).length === 0}
                    <p class="text-xs text-text-muted">
                      This plan has no steps yet, so it proposes nothing.
                    </p>
                  {:else}
                    <ul class="flex flex-col gap-4">
                      {#each openPlan.tasks ?? [] as step (step.id)}
                        <li class="flex flex-wrap items-center justify-between gap-8 text-xs">
                          <div class="flex flex-wrap items-center gap-8">
                            <span class="text-text">{step.title}</span>
                            <span class="text-text-muted">{describeAnchor(step)}</span>
                            {#if step.defaultAssigneeRole !== null}
                              <Badge variant="neutral">{step.defaultAssigneeRole}</Badge>
                            {/if}
                            {#if step.priority !== "normal"}
                              <Badge variant={step.priority === "urgent" ? "danger" : "neutral"}>
                                {PRIORITY_LABELS[step.priority]}
                              </Badge>
                            {/if}
                          </div>
                          {#if canManage}
                            <Button
                              variant="ghost"
                              disabled={saving}
                              title="Remove this step. Tasks already added from it are untouched."
                              onclick={() =>
                                runWrite(
                                  () => removePlanStep(fetch, step.id, newWriteKey()),
                                  "The step was not removed.",
                                )}
                            >
                              <Trash2 aria-hidden="true" />
                            </Button>
                          {/if}
                        </li>
                      {/each}
                    </ul>
                  {/if}

                  {#if canManage}
                    {#if composingStep}
                      <div class="flex flex-col gap-8 rounded-md border border-border-subtle p-12">
                        <div class="flex flex-col gap-4">
                          <Label for="step-title">What to do</Label>
                          <Input id="step-title" bind:value={stepTitle} disabled={saving} />
                        </div>
                        <div class="flex flex-col gap-4">
                          <Label for="step-body">Detail</Label>
                          <Textarea id="step-body" bind:value={stepBody} rows={2} disabled={saving} />
                        </div>
                        <div class="flex flex-wrap items-end gap-16">
                          <div class="flex flex-col gap-4">
                            <Label for="step-anchor">Due</Label>
                            <div class="w-xs">
                              <ChoicePicker
                                options={DUE_ANCHOR_CHOICES}
                                inputId="step-anchor"
                                label="Due"
                                disabled={saving}
                                bind:value={
                                  () => stepAnchor,
                                  (next) => (stepAnchor = next === "matter_opened" ? "matter_opened" : "none")
                                }
                              />
                            </div>
                          </div>
                          {#if stepAnchor !== "none"}
                            <div class="flex flex-col gap-4">
                              <Label for="step-offset">Days</Label>
                              <Input
                                id="step-offset"
                                type="number"
                                bind:value={stepOffset}
                                disabled={saving}
                                class="w-96"
                              />
                            </div>
                          {/if}
                          <div class="flex flex-col gap-4">
                            <Label for="step-priority">Priority</Label>
                            <div class="w-3xs">
                              <ChoicePicker
                                options={PRIORITY_CHOICES}
                                inputId="step-priority"
                                label="Priority"
                                disabled={saving}
                                bind:value={
                                  () => stepPriority,
                                  (next) => {
                                    const chosen = TASK_PRIORITIES.find((priority) => priority === next);
                                    if (chosen !== undefined) stepPriority = chosen;
                                  }
                                }
                              />
                            </div>
                          </div>
                          <div class="flex flex-col gap-4">
                            <Label for="step-role">Give it to (role)</Label>
                            <Input
                              id="step-role"
                              bind:value={stepRole}
                              disabled={saving}
                              placeholder="assigned_paralegal"
                              class="w-3xs"
                            />
                          </div>
                        </div>
                        <p class="text-xs text-text-muted">
                          The role is matched against each matter's own team when the plan is offered.
                          Where nobody holds it, the step arrives unassigned and says so.
                        </p>
                        <div class="flex justify-end gap-8">
                          <Button
                            variant="secondary"
                            disabled={saving}
                            onclick={() => (composingStep = false)}
                          >
                            Cancel
                          </Button>
                          <Button
                            disabled={saving || stepTitle.trim().length === 0}
                            onclick={() =>
                              runWrite(
                                () =>
                                  addPlanStep(
                                    fetch,
                                    plan.id,
                                    {
                                      title: stepTitle.trim(),
                                      body: stepBody.trim() === "" ? null : stepBody.trim(),
                                      priority: stepPriority,
                                      defaultAssigneeRole:
                                        stepRole.trim() === "" ? null : stepRole.trim(),
                                      dueAnchor: stepAnchor,
                                      offsetDays: stepAnchor === "none" ? null : (offsetNumber ?? 0),
                                      position: (openPlan?.tasks ?? []).length,
                                    },
                                    newWriteKey(),
                                  ),
                                "The step was not added.",
                                () => {
                                  composingStep = false;
                                  stepTitle = "";
                                  stepBody = "";
                                  stepRole = "";
                                  stepOffset = "";
                                  stepAnchor = "none";
                                  stepPriority = "normal";
                                },
                              )}
                          >
                            Add Step
                          </Button>
                        </div>
                      </div>
                    {:else}
                      <div class="flex justify-end">
                        <Button variant="ghost" disabled={saving} onclick={() => (composingStep = true)}>
                          <Plus aria-hidden="true" />
                          Add Step
                        </Button>
                      </div>
                    {/if}
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </LoadingRegion>
</SettingsScrollRegion>
