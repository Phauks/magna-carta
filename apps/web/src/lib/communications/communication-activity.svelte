<script lang="ts">
  /*
   * What happened on a call being recorded, and what came of it — the Activity section of the form
   * while a record is being MADE.
   *
   * FORMAL WORDS, AND SPAM AMONG THEM (owner, 2026-11-09: the first wording, "what happened", was
   * "so informal"; "add a way to show it was spam"). An incoming call is Answered, Transferred, a
   * Message Taken, or Spam; an outgoing one Connected, left a Voicemail, or got No Answer. Spam files
   * the call as spam by itself, so the Belongs To field is not asked about.
   *
   * A TRANSFER AND A MESSAGE NAME A COLLEAGUE (owner, same day: "sometimes a call is transferred to
   * another person, or a message is left for a person"). A transferred call becomes that member's
   * call. A message becomes a task in that member's list, saved in the same write as the call, so
   * the assignment notification every task raises is what tells them; ticking it done closes the
   * message.
   *
   * A TEXT HAS NO ACTIVITY BUT SPAM. Nobody answers or transfers a text, so the only question asked
   * of one is whether it was spam.
   */
  import Checkbox from "@magna-carta/design-system/checkbox";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Label from "@magna-carta/design-system/label";
  import { personName } from "@magna-carta/design-system/formatters";
  import { meGetOptions } from "@magna-carta/api-client";
  import { createQuery } from "@tanstack/svelte-query";
  import { SESSION_STABLE } from "$lib/api/screen-data.ts";
  import ButtonChoice, { type ButtonChoiceOption } from "$lib/components/button-choice.svelte";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";
  import MemberPicker from "$lib/matters/member-picker.svelte";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import { CALL_OUTCOME_LABELS, SPAM_KIND_LABELS } from "./communication-vocabulary.ts";
  import {
    INBOUND_CALL_OUTCOMES,
    OUTBOUND_CALL_OUTCOMES,
    SPAM_KINDS,
    type CallOutcome,
    type SpamKind,
  } from "./communications-api.ts";
  import {
    isTextDraft,
    MESSAGE_REQUESTS,
    messageTaskTitle,
    type LogDraft,
    type MessageRequest,
  } from "./log-draft.ts";

  let {
    draft = $bindable(),
    busy = false,
  }: {
    draft: LogDraft;
    busy?: boolean;
  } = $props();

  /** Who is recording the call, who is therefore the one who received any message. */
  const sessionRead = createQuery(() => ({ ...meGetOptions(), staleTime: SESSION_STABLE }));
  const selfUserId = $derived(sessionRead.data?.user.id ?? null);

  const identity = $props.id();

  $effect(() => {
    void firmRoster.load(fetch);
  });

  const text = $derived(isTextDraft(draft));

  const outcomeOptions = $derived.by((): readonly ButtonChoiceOption<CallOutcome>[] => {
    const outcomes: readonly CallOutcome[] = text
      ? ["spam"]
      : draft.direction === "inbound"
        ? INBOUND_CALL_OUTCOMES
        : OUTBOUND_CALL_OUTCOMES;
    return outcomes.map((value) => ({ value, label: CALL_OUTCOME_LABELS[value] }));
  });

  /*
   * An outcome from the other direction, or one a text cannot carry, is dropped rather than kept:
   * switching Incoming to Outgoing after pressing Transferred must not save a transfer on a call the
   * firm placed.
   */
  $effect(() => {
    const outcome = draft.outcome;
    if (outcome === null) return;
    if (!outcomeOptions.some((option) => option.value === outcome)) draft.outcome = null;
  });

  const SPAM_OPTIONS: readonly ButtonChoiceOption<SpamKind>[] = SPAM_KINDS.map((value) => ({
    value,
    label: SPAM_KIND_LABELS[value],
  }));

  const REQUEST_LABELS: Readonly<Record<MessageRequest, string>> = {
    callBack: "A Call Back",
    willCallAgain: "Will Call Again",
    noReplyNeeded: "No Reply Needed",
  };
  const REQUEST_OPTIONS: readonly ButtonChoiceOption<MessageRequest>[] = MESSAGE_REQUESTS.map(
    (value) => ({ value, label: REQUEST_LABELS[value] }),
  );

  const receivedBy = $derived.by((): string => {
    if (selfUserId === null) return "Me";
    const self = (firmRoster.members ?? []).find((member) => member.userId === selfUserId);
    return self === undefined ? "Me" : `Me (${personName(self.displayName)})`;
  });

  const nameOf = (userId: string | null): string => {
    if (userId === null) return "them";
    const member = (firmRoster.members ?? []).find((candidate) => candidate.userId === userId);
    return member === undefined ? "them" : personName(member.displayName);
  };
</script>

<section class="flex flex-col gap-8" aria-labelledby="{identity}-activity">
  <FieldLabel as="h3" id="{identity}-activity">Activity</FieldLabel>
  <ButtonChoice
    label="Activity"
    options={outcomeOptions}
    value={draft.outcome}
    disabled={busy}
    onchange={(chosen) => (draft.outcome = chosen)}
  />

  {#if draft.outcome === "transferred"}
    <div class="flex flex-col gap-8 rounded-md border border-border-default p-12">
      <Label for="{identity}-transfer">Transferred To</Label>
      <MemberPicker
        members={firmRoster.active}
        bind:value={draft.transferToUserId}
        inputId="{identity}-transfer"
        label="Transferred To"
        disabled={busy}
      />
      <p class="text-xs text-text-muted">
        {draft.transferToUserId === null
          ? "Whoever it went to becomes the person on this call, so they can add their own notes to it."
          : `${nameOf(draft.transferToUserId)} becomes the person on this call, so they can add their own notes to it.`}
      </p>
    </div>
  {:else if draft.outcome === "messageTaken"}
    <div class="flex flex-col gap-12 rounded-md border border-border-default p-12">
      <div class="grid gap-12 @sm:grid-cols-2">
        <div class="flex flex-col gap-8">
          <Label for="{identity}-message-for">Message For</Label>
          <MemberPicker
            members={firmRoster.active}
            bind:value={draft.messageForUserId}
            inputId="{identity}-message-for"
            label="Message For"
            disabled={busy}
          />
        </div>
        <div class="flex flex-col gap-8">
          <span class="text-sm font-medium">Received By</span>
          <span class="flex min-h-40 items-center">{receivedBy}</span>
        </div>
      </div>
      <div class="flex flex-col gap-8">
        <span class="text-sm font-medium">Requested</span>
        <ButtonChoice
          label="Requested"
          options={REQUEST_OPTIONS}
          value={draft.messageRequest}
          disabled={busy}
          onchange={(chosen) => (draft.messageRequest = chosen)}
        />
      </div>
      <div class="grid items-end gap-12 @sm:grid-cols-2">
        <div class="flex flex-col gap-8">
          <DatePicker
            label="By"
            value={civilDateValue(draft.messageByDate)}
            onValueChange={(next) => (draft.messageByDate = civilDateTextOrEmpty(next))}
            disabled={busy}
          />
        </div>
        <div class="flex min-h-40 items-center gap-8">
          <Checkbox
            id="{identity}-urgent"
            bind:checked={draft.messageUrgent}
            disabled={busy}
          />
          <Label for="{identity}-urgent">Urgent</Label>
        </div>
      </div>
      <p class="text-xs text-text-muted">
        Saving sends {nameOf(draft.messageForUserId)} a notification and puts "{messageTaskTitle(
          draft,
        )}" on their task list, linked to this call. Ticking the task done closes the message.
      </p>
    </div>
  {:else if draft.outcome === "spam"}
    <div class="flex flex-col gap-8 rounded-md border border-border-default p-12">
      <ButtonChoice
        label="Kind of spam"
        options={SPAM_OPTIONS}
        value={draft.spamKind}
        disabled={busy}
        onchange={(chosen) => (draft.spamKind = chosen)}
      />
      <p class="text-xs text-text-muted">
        Saving files this {text ? "text" : "call"} as not a matter, so it skips the queue. The next call
        from this number shows how many times the firm has marked it as spam.
      </p>
    </div>
  {/if}
</section>
