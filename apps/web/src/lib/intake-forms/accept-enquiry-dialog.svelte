<script lang="ts">
  /*
   * Accept an enquiry — where the firm CHECKS what a stranger typed before any of it becomes a
   * record.
   *
   * THE FIELDS ARE PRE-FILLED AND EVERY ONE IS EDITABLE, and that is the whole screen. A form is a
   * way for somebody outside the firm to put information in; nothing they typed is trusted until a
   * person here has looked at it. The reason is worth the reader knowing, so the dialog says it: the
   * directory is permanent, and a name mistyped on a web form is in the firm's conflicts corpus for
   * good.
   *
   * WHAT THE VISITOR ACTUALLY WROTE STAYS ON SCREEN while the member corrects the fields beside it.
   * Showing only the parsed fields would hide the thing being checked — a member fixing "jonh" to
   * "John" should be able to see that "jonh" is what arrived, and that nothing else in the enquiry
   * contradicts the correction.
   *
   * The name split is a STARTING POINT and the dialog does not pretend otherwise. Names do not split
   * on spaces, and the proposal's own comment says so; here it shows as three editable boxes rather
   * than as an answer.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Select from "@magna-carta/design-system/select";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import Textarea from "@magna-carta/design-system/textarea";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import MemberPicker from "$lib/matters/member-picker.svelte";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import {
    acceptSubmission,
    newWriteKey,
    proposeAcceptance,
    type AcceptanceProposal,
  } from "./intake-forms-api.ts";

  interface Props {
    open: boolean;
    readonly formId: string;
    readonly submissionId: string | null;
    /** The member the intake will be responsible to — the reader, by default. */
    readonly responsibleMemberId: string;
    readonly onAccepted: (created: { entityId: string; matterId: string }) => void;
  }

  let { open = $bindable(), formId, submissionId, responsibleMemberId, onAccepted }: Props =
    $props();

  let proposal = $state<AcceptanceProposal | null>(null);
  let failure = $state<StatedFailure | null>(null);

  let entityKind = $state<"person" | "organization">("person");
  let given = $state("");
  let family = $state("");
  let middle = $state("");
  let legalName = $state("");
  let matterTitle = $state("");
  let note = $state("");
  /**
   * Who carries the intake. It defaults to the reader because they are the person looking at the
   * enquiry, and it is a picker rather than a fact because the member who clears the queue is
   * routinely not the member the work belongs to.
   */
  let responsible = $state<string | null>(null);

  async function load(): Promise<void> {
    proposal = null;
    failure = null;
    if (submissionId === null) return;
    const outcome = await proposeAcceptance(fetch, formId, submissionId);
    if (outcome.kind !== "ok") {
      failure = stated(outcome.failure, "This enquiry could not be read.");
      return;
    }
    const read = outcome.value;
    proposal = read;
    entityKind = read.suggestedEntityKind;
    given = read.personName?.given ?? "";
    family = read.personName?.family ?? "";
    middle = read.personName?.middle ?? "";
    legalName = read.organizationName ?? "";
    matterTitle = read.matterTitle;
    note = "";
    responsible = responsibleMemberId;
  }

  const refusal = $derived(
    proposal === null
      ? "Reading the enquiry."
      : matterTitle.trim() === ""
        ? "Give the matter a title."
        : responsible === null
          ? "Say who carries this intake."
          : entityKind === "organization"
            ? legalName.trim() === ""
              ? "Give the organization a name."
              : undefined
            : given.trim() === "" && family.trim() === ""
              ? "Give the person a name."
              : undefined,
  );

  async function accept(): Promise<ActionOutcome> {
    if (refusal !== undefined || submissionId === null || responsible === null) return "refused";
    failure = null;
    const outcome = await acceptSubmission(
      fetch,
      formId,
      submissionId,
      {
        entityKind,
        given: entityKind === "person" ? given.trim() : null,
        family: entityKind === "person" ? family.trim() : null,
        middle: entityKind === "person" && middle.trim() !== "" ? middle.trim() : null,
        legalName: entityKind === "organization" ? legalName.trim() : null,
        matterTitle: matterTitle.trim(),
        responsibleMemberId: responsible,
        note: note.trim() === "" ? null : note.trim(),
      },
      newWriteKey(),
    );
    if (outcome.kind !== "ok") {
      failure = stated(outcome.failure, "This enquiry could not be accepted.");
      return "refused";
    }
    onAccepted(outcome.value);
    return "done";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Accept This Enquiry"
  subtitle="Check what was sent, correct anything that is wrong, and this becomes a contact and an intake."
  commitLabel="Accept Enquiry"
  commitBusyLabel="Accepting"
  commitRefusal={refusal}
  unsavedChanges={false}
  onOpen={() => {
    void load();
    void firmRoster.load(fetch);
  }}
  onCommit={accept}
>
  {#snippet fields({ busy })}
    <LoadingRegion loading={proposal === null} label="Reading the enquiry">
      {#if proposal !== null}
        <div class="flex flex-col gap-20">
          <Alert.Root variant="info">
            <Alert.Title>Check this before you accept it.</Alert.Title>
            <Alert.Description>
              Everything below was typed by somebody the firm has not met. What you confirm here is
              what goes into your contacts, and a contact is kept for good so a conflicts check can
              still find it — so a name that is wrong now stays wrong.
            </Alert.Description>
          </Alert.Root>

          <div class="flex flex-col gap-6">
            <Label id="accept-kind-label">Record this as</Label>
            <Select.Root
              type="single"
              value={entityKind}
              onValueChange={(value) =>
                (entityKind = (value ?? "person") as "person" | "organization")}
            >
              <Select.Trigger aria-labelledby="accept-kind-label" disabled={busy}>
                {entityKind === "organization" ? "An organization" : "A person"}
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="person">A person</Select.Item>
                <Select.Item value="organization">An organization</Select.Item>
              </Select.Content>
            </Select.Root>
          </div>

          {#if entityKind === "organization"}
            <div class="flex flex-col gap-6">
              <Label for="accept-legal-name">Organization name</Label>
              <Input id="accept-legal-name" bind:value={legalName} disabled={busy} autocomplete="off" />
              <p class="text-xs text-text-muted">
                The legal name if you know it — a trading name is what people type, and it is not
                what a conflicts check needs to match.
              </p>
            </div>
          {:else}
            <div class="flex flex-col gap-6">
              <Label for="accept-given">First name</Label>
              <Input id="accept-given" bind:value={given} disabled={busy} autocomplete="off" />
            </div>
            <div class="flex flex-col gap-6">
              <Label for="accept-middle">Middle name</Label>
              <Input id="accept-middle" bind:value={middle} disabled={busy} autocomplete="off" />
            </div>
            <div class="flex flex-col gap-6">
              <Label for="accept-family">Last name</Label>
              <Input id="accept-family" bind:value={family} disabled={busy} autocomplete="off" />
              <p class="text-xs text-text-muted">
                We split what they typed on the spaces, which is a guess. Move the parts if it is
                wrong.
              </p>
            </div>
          {/if}

          <div class="flex flex-col gap-6">
            <Label for="accept-title">Matter title</Label>
            <Input id="accept-title" bind:value={matterTitle} disabled={busy} autocomplete="off" />
          </div>

          <div class="flex flex-col gap-6">
            <MemberPicker
              members={firmRoster.members ?? []}
              bind:value={responsible}
              inputId="accept-responsible"
              label="Responsible Attorney"
              disabled={busy}
            />
            {#if firmRoster.failure !== null}
              <p class="text-xs text-text-muted">{firmRoster.failure}</p>
            {/if}
          </div>

          <div class="flex flex-col gap-6">
            <Label for="accept-note">Note</Label>
            <Textarea id="accept-note" rows={2} bind:value={note} disabled={busy} />
            <p class="text-xs text-text-muted">Optional. Only members see this.</p>
          </div>

          <!--
            What actually arrived, kept on screen while the member corrects the fields above it.
            Hiding it would hide the thing being checked.
          -->
          <div class="flex flex-col gap-8 border-t border-border-subtle pt-16">
            <span class="text-sm font-medium">What they sent</span>
            {#each proposal.answers as answer (answer.label)}
              <div class="flex flex-col gap-2">
                <span class="text-xs text-text-muted">{answer.label}</span>
                <span class="whitespace-pre-line text-sm">{answer.value}</span>
              </div>
            {/each}
          </div>

          <p class="text-xs text-text-muted">
            Accepting adds the contact and starts an intake. It does not run a conflicts check —
            that happens on the intake, where it can be recorded against the matter.
          </p>

          {#if failure !== null}
            <FailureNotice
              failure={failure.failure}
              title="The Enquiry Was Not Accepted"
              fallback={failure.fallback}
            />
          {/if}
        </div>
      {/if}
    </LoadingRegion>
  {/snippet}
</ActionDialog>
