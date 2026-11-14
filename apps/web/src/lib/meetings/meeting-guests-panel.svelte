<script lang="ts">
  /*
   * Who from outside the firm can join this meeting, and the three things a host does about it.
   *
   * A GUEST IS SOMEBODY ALREADY ON THE EVENT. The list is the event's own participants who are a
   * person or an organization in the Directory — never an address typed into a box — because the
   * record must always name somebody the firm knows and the conflicts corpus can see. A participant
   * recorded only by name (a judge, a court reporter) has no address and nothing a link could be
   * minted for, so their Invite is disabled and the way forward is to add them to the Directory:
   * a deliberate act with a known cost, never a side effect of sending an invitation.
   *
   * IT IS A READING PANEL. A host opens it to see who has a link and whether they have used it at
   * least as often as to send one, so each act is offered in place, on the row it is about, and the
   * two that take something away — replacing a link and withdrawing one — each ask first, because a
   * guest in the room on the old link is taken out of it.
   *
   * THE TOKEN IS NEVER SHOWN, not even in part. It only ever travels by e-mail, and a panel that put
   * it on a screen would be a way for it to travel some other way.
   *
   * A LINK OUTLIVES ITS PLACE ON THE EVENT. Somebody taken off the event keeps whatever link they
   * were sent until it expires or is withdrawn, so an invitation with no participant row behind it
   * is drawn as a row of its own, marked as no longer on the event, with Withdraw still on it.
   * Building the list from the event alone made exactly that link invisible, and a link nobody can
   * see is a link nobody can take back.
   *
   * IT READS WHEN IT OPENS AND NOT BEFORE. It has two entrances — the event's entry window and the
   * room itself — and in the room especially, the host is in the middle of a meeting and has not
   * asked about guests until they open this.
   */
  import { createQuery } from "@tanstack/svelte-query";
  import {
    calendarGetEventOptions,
    calendarGetFirmEventOptions,
    directoryEntityNamesOptions,
  } from "@magna-carta/api-client";
  import Building2 from "@lucide/svelte/icons/building-2";
  import Mail from "@lucide/svelte/icons/mail";
  import UserRound from "@lucide/svelte/icons/user-round";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import { EMAIL_ADDRESS_REFUSAL, isEmailAddress } from "@magna-carta/directory/email-address";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { SoonAffordance } from "@magna-carta/design-system/maturity";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { failureOf } from "$lib/api/api-client.ts";
  import {
    inviteMeetingGuest,
    inviteMeetingGuestByAddress,
    readMeetingGuests,
    revokeMeetingGuestLink,
    rotateMeetingGuestLink,
    type MeetingGuestInvitation,
  } from "./guest-api.ts";
  import { refusedAs, type MeetingWrite } from "./meetings-api.ts";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import type { MatterEventParticipantDetail } from "@magna-carta/api-client";
  import type { Failure } from "$lib/api/problem.ts";

  let {
    open = $bindable(false),
    subject,
    meetingId,
    eventKind,
    eventId,
  }: {
    open?: boolean;
    /** Which meeting this is about, named once. */
    subject: RecordSubject;
    /** The meeting the invitations are on. */
    meetingId: string;
    /** Which side of the calendar the meeting's event is on, which decides how it is read. */
    eventKind: "matter" | "firm";
    /** The matter event's or firm event's own identifier, whose participants are the candidates. */
    eventId: string;
  } = $props();

  /** What an unnamed Directory record is drawn as. The handle is never printed at a reader. */
  const UNNAMED_RECORD = "Directory record";

  // ---- who is on the event ----------------------------------------------------------------------

  const matterEventRead = createQuery(() => ({
    ...calendarGetEventOptions({ path: { eventId } }),
    enabled: open && eventKind === "matter",
  }));
  const firmEventRead = createQuery(() => ({
    ...calendarGetFirmEventOptions({ path: { firmEventId: eventId } }),
    enabled: open && eventKind === "firm",
  }));
  // Two reads rather than one over a ternary, for the reason the entry control gives: the two
  // operations have different path shapes, and only one of them is ever enabled.
  const eventRead = $derived(eventKind === "matter" ? matterEventRead : firmEventRead);

  /** The participants who could be a guest: everybody on the event who is not at the firm. */
  const candidates = $derived<readonly MatterEventParticipantDetail[]>(
    (eventRead.data?.participants ?? []).filter(
      (participant) => participant.participantKind !== "member",
    ),
  );

  const entityIds = $derived(
    candidates.flatMap((participant) =>
      participant.participantKind === "entity" && participant.entityId !== null
        ? [participant.entityId]
        : [],
    ),
  );

  /*
   * What each Directory record is called. The event's participant rows carry the handle and not the
   * name, and a panel that printed a handle at a host would be answering "who can I invite" with
   * strings nobody recognises.
   */
  const namesRead = createQuery(() => ({
    ...directoryEntityNamesOptions({ query: { ids: entityIds.join(",") } }),
    enabled: open && entityIds.length > 0,
  }));

  // ---- who has a link ---------------------------------------------------------------------------

  let invitations = $state<readonly MeetingGuestInvitation[] | null>(null);
  let invitationsFailure = $state<Failure | null>(null);

  async function refreshInvitations(): Promise<void> {
    const outcome = await readMeetingGuests(meetingId);
    if (outcome.kind === "ok") {
      invitations = outcome.value;
      invitationsFailure = null;
      return;
    }
    invitationsFailure = outcome.failure;
  }

  $effect(() => {
    if (!open) return;
    void refreshInvitations();
  });

  // ---- the rows ---------------------------------------------------------------------------------

  interface GuestRow {
    readonly key: string;
    /** The Directory record a link would be minted for, or null for somebody recorded by name only. */
    readonly entityId: string | null;
    readonly name: string;
    readonly entityKind: "person" | "organization" | null;
    /** The invitation this record holds on this meeting, or null where none was ever sent. */
    readonly invitation: MeetingGuestInvitation | null;
    /** False for an invitation whose person or organization has since been taken off the event. */
    readonly onTheEvent: boolean;
  }

  const rows = $derived.by((): readonly GuestRow[] => {
    const names = new Map(
      (namesRead.data?.data ?? []).map((entry) => [entry.entityId, entry] as const),
    );
    return candidates.map((participant) => {
      const entityId = participant.participantKind === "entity" ? participant.entityId : null;
      const invitation =
        entityId === null
          ? null
          : (invitations?.find((candidate) => candidate.entityId === entityId) ?? null);
      const named = entityId === null ? undefined : names.get(entityId);
      return {
        key: participant.id,
        entityId,
        name:
          participant.participantName ??
          named?.displayName ??
          invitation?.invitedName ??
          UNNAMED_RECORD,
        entityKind: named?.entityKind ?? invitation?.entityKind ?? null,
        invitation,
        onTheEvent: true,
      };
    });
  });

  /*
   * The invitations nobody on the event holds any more, after the event's own people. Drawn only once
   * the event has been read: before that, every invitation would look like one whose person had left.
   */
  const departedRows = $derived.by((): readonly GuestRow[] => {
    if (eventRead.data === undefined || invitations === null) return [];
    const stillOnTheEvent = new Set(entityIds);
    return invitations
      .filter((invitation) => !stillOnTheEvent.has(invitation.entityId))
      .map((invitation) => ({
        key: invitation.id,
        entityId: invitation.entityId,
        // The name the link was sent under, frozen when it was minted: the Directory's name today is
        // not who this invitation was for.
        name: invitation.invitedName,
        entityKind: invitation.entityKind,
        invitation,
        onTheEvent: false,
      }));
  });

  const allRows = $derived([...rows, ...departedRows]);

  type LinkStanding = "none" | "live" | "expired" | "withdrawn";

  /** Where a record's link stands, read against the moment the panel is drawn. */
  function standingOf(invitation: MeetingGuestInvitation | null): LinkStanding {
    if (invitation === null) return "none";
    if (invitation.revokedAt !== null) return "withdrawn";
    return Date.parse(invitation.expiresAt) <= Date.now() ? "expired" : "live";
  }

  /** The standing as the row states it: a fact and, where there is one, its instant. */
  function standingLine(invitation: MeetingGuestInvitation | null): string {
    switch (standingOf(invitation)) {
      case "none":
        return "No link sent";
      case "withdrawn":
        return `Link withdrawn ${formatInstant(invitation?.revokedAt ?? "")}`;
      case "expired":
        return `Link expired ${formatInstant(invitation?.expiresAt ?? "")}`;
      case "live":
        return `Link works until ${formatInstant(invitation?.expiresAt ?? "")}`;
    }
  }

  /** How many times the link has been used to come to the door. */
  function arrivalsLine(invitation: MeetingGuestInvitation): string {
    if (invitation.arrivalCount === 0) return "Not used yet";
    return invitation.arrivalCount === 1 ? "Used once" : `Used ${invitation.arrivalCount} times`;
  }

  // ---- the three acts ---------------------------------------------------------------------------

  /** The last refused act, rendered in the panel's reserved band. */
  let writeFailure = $state<Failure | null>(null);
  /** The record an act is in flight for, so its controls cannot be pressed twice. */
  let busyKey = $state<string | null>(null);

  async function act(
    row: GuestRow,
    write: () => Promise<MeetingWrite<unknown>>,
  ): Promise<ActionOutcome> {
    busyKey = row.key;
    writeFailure = null;
    const outcome = await write();
    busyKey = null;
    if (outcome.kind !== "ok") {
      writeFailure = outcome.failure;
      return "refused";
    }
    await refreshInvitations();
    return "committed";
  }

  function invite(row: GuestRow): void {
    const entityId = row.entityId;
    if (entityId === null) return;
    void act(row, () => inviteMeetingGuest(meetingId, entityId));
  }

  /*
   * SOMEBODY NOT ON THE LIST, by name and e-mail address. Most guests are somebody in the Directory,
   * but a host is not made to find or create the entry first: the server matches the address to the
   * Directory, or makes a person there marked as needing review, puts them on the event and sends the
   * same link. The list is read again afterwards, so the new guest appears as an ordinary row.
   */
  let typedName = $state("");
  let typedAddress = $state("");
  let typedBusy = $state(false);
  const typedAddressRefusal = $derived(
    typedAddress.trim().length > 0 && !isEmailAddress(typedAddress.trim())
      ? EMAIL_ADDRESS_REFUSAL
      : null,
  );
  const typedReady = $derived(
    typedName.trim().length > 0 && typedAddress.trim().length > 0 && typedAddressRefusal === null,
  );

  async function inviteTyped(): Promise<void> {
    if (!typedReady || typedBusy) return;
    typedBusy = true;
    writeFailure = null;
    const outcome = await inviteMeetingGuestByAddress(
      meetingId,
      typedName.trim(),
      typedAddress.trim(),
    );
    typedBusy = false;
    if (outcome.kind !== "ok") {
      writeFailure = outcome.failure;
      return;
    }
    typedName = "";
    typedAddress = "";
    void eventRead.refetch();
    await refreshInvitations();
  }

  /** The row a question is standing over, and which question. Null while none is. */
  let asking = $state<{ readonly row: GuestRow; readonly act: "rotate" | "revoke" } | null>(null);
  let rotating = $state(false);
  let revoking = $state(false);

  function askToRotate(row: GuestRow): void {
    asking = { row, act: "rotate" };
    rotating = true;
  }

  function askToRevoke(row: GuestRow): void {
    asking = { row, act: "revoke" };
    revoking = true;
  }

  function rotate(): Promise<ActionOutcome> {
    const invitation = asking?.row.invitation;
    if (asking === null || invitation === undefined || invitation === null) {
      return Promise.resolve("refused");
    }
    return act(asking.row, () => rotateMeetingGuestLink(meetingId, invitation.id));
  }

  function revoke(): Promise<ActionOutcome> {
    const invitation = asking?.row.invitation;
    if (asking === null || invitation === undefined || invitation === null) {
      return Promise.resolve("refused");
    }
    return act(asking.row, () => revokeMeetingGuestLink(meetingId, invitation.id));
  }

  /** The question's subject: this meeting, and the person the link is for. */
  const questionSubject = $derived<RecordSubject>({
    ...subject,
    facts: [...(subject.facts ?? []), ...(asking === null ? [] : [asking.row.name])],
  });

  const loading = $derived(eventRead.isPending || (invitations === null && invitationsFailure === null));
  const readFailure = $derived(
    eventRead.isError ? failureOf(eventRead.error) : invitationsFailure,
  );
</script>

{#snippet refusal(failure: Failure)}
  <FailureNotice
    {failure}
    subject="This meeting"
    title={refusedAs(failure, "guest-not-invitable") ? "Nobody Was Invited" : "Nothing Changed"}
    fallback={refusedAs(failure, "guest-not-invitable")
      ? "Couldn't send that person a link. Check the name and address, or invite them from the list."
      : "That didn't happen."}
    whenSilent="Couldn't connect. Nothing changed for this meeting's guests. Try again."
  />
{/snippet}

<ActionDialog bind:open kind="reading" heading="Guests" subtitle={subject}>
  {#snippet notice()}
    {#if writeFailure !== null}
      {@render refusal(writeFailure)}
    {/if}
  {/snippet}

  {#snippet fields()}
    <LoadingRegion
      class="flex flex-col gap-12"
      {loading}
      label="Reading who can join this meeting"
      failed={readFailure !== null}
    >
      {#snippet failure()}
        {#if readFailure !== null}
          <FailureNotice
            failure={readFailure}
            subject="This meeting"
            fallback="Couldn't load who can join this meeting."
            whenSilent="Couldn't connect. Couldn't load who can join this meeting. Try again."
            onRetry={() => {
              void eventRead.refetch();
              void refreshInvitations();
            }}
          />
        {/if}
      {/snippet}

      <!-- The structure renders first and states its own emptiness inside itself: an event with
           nobody on it from outside the firm is the ordinary standing of most internal meetings. -->
      <ul class="flex flex-col gap-12">
        {#each allRows as row (row.key)}
          {@const standing = standingOf(row.invitation)}
          {@const busy = busyKey === row.key}
          <li class="flex flex-col gap-8">
            <div class="flex items-center gap-8">
              {#if row.entityKind === "organization"}
                <Building2 class="size-16 shrink-0 text-text-muted" aria-hidden="true" />
              {:else}
                <UserRound class="size-16 shrink-0 text-text-muted" aria-hidden="true" />
              {/if}
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-sm" title={row.name}>{row.name}</span>
                <span class="truncate text-xs text-text-muted">
                  {#if row.entityId === null}
                    Not in the Directory
                  {:else if !row.onTheEvent}
                    No longer on the event&nbsp;· {standingLine(row.invitation)}{#if row.invitation !== null}&nbsp;·
                      {arrivalsLine(row.invitation)}{/if}
                  {:else}
                    {standingLine(row.invitation)}{#if row.invitation !== null}&nbsp;·
                      {arrivalsLine(row.invitation)}{/if}
                  {/if}
                </span>
              </span>
            </div>

            <!-- Each act is offered on the row it is about, and names the person, because a panel of
                 five rows would otherwise offer five controls all called Invite. -->
            {#if row.onTheEvent || standing === "live"}
              <div class="flex flex-wrap items-center justify-end gap-8">
                {#if row.entityId === null}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled
                    title="Only someone in the Directory can be sent a link."
                  >
                    <Mail class="size-16" aria-hidden="true" />
                    Invite
                  </Button>
                  <SoonAffordance reason="adding an event's participant to the Directory from here">
                    {#snippet control(soon)}
                      <Button {...soon} variant="ghost" size="sm">Add to Directory</Button>
                    {/snippet}
                  </SoonAffordance>
                {:else if !row.onTheEvent}
                  <!-- Withdraw and nothing else. A new link, or a first one, goes only to somebody the
                       event still names; for anybody else the one act left is taking this one back,
                       and a link that has already stopped working leaves nothing to press. -->
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label="Withdraw the link for {row.name}"
                    onclick={() => askToRevoke(row)}
                  >
                    Withdraw
                  </Button>
                {:else if standing === "live"}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label="Withdraw the link for {row.name}"
                    onclick={() => askToRevoke(row)}
                  >
                    Withdraw
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    aria-label="Send a new link to {row.name}"
                    onclick={() => askToRotate(row)}
                  >
                    Send a New Link
                  </Button>
                {:else}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    aria-label="Invite {row.name}"
                    onclick={() => invite(row)}
                  >
                    <Mail class="size-16" aria-hidden="true" />
                    Invite
                  </Button>
                {/if}
              </div>
            {/if}
          </li>
        {:else}
          <li class="text-sm text-text-muted">Nobody from outside the firm is on this event.</li>
        {/each}
      </ul>

      <form
        class="flex flex-col gap-8 border-t border-border-subtle pt-12"
        onsubmit={(submitted) => {
          submitted.preventDefault();
          void inviteTyped();
        }}
      >
        <p class="text-sm">Invite somebody by e-mail</p>
        <div class="flex flex-col gap-4">
          <Label for="guest-typed-name">Name</Label>
          <Input id="guest-typed-name" bind:value={typedName} disabled={typedBusy} autocomplete="off" />
        </div>
        <div class="flex flex-col gap-4">
          <Label for="guest-typed-address">E-mail address</Label>
          <Input
            id="guest-typed-address"
            type="email"
            bind:value={typedAddress}
            disabled={typedBusy}
            autocomplete="off"
            aria-invalid={typedAddressRefusal !== null}
          />
          {#if typedAddressRefusal !== null}
            <p class="text-xs text-text-danger">{typedAddressRefusal}</p>
          {/if}
        </div>
        <p class="text-xs text-text-muted">
          If nobody in the Directory has this address, a person is added there for review.
        </p>
        <div class="flex justify-end">
          <Button type="submit" variant="secondary" size="sm" disabled={!typedReady || typedBusy}>
            <Mail class="size-16" aria-hidden="true" />
            {typedBusy ? "Inviting" : "Invite"}
          </Button>
        </div>
      </form>
    </LoadingRegion>
  {/snippet}
</ActionDialog>

<!-- Replacing a link, over the reading panel it was asked from: whoever holds the old one loses it,
     including somebody in the room on it right now. -->
<ActionDialog
  bind:open={rotating}
  kind="confirm"
  heading="Send a New Link"
  subtitle={questionSubject}
  commitLabel="Send a New Link"
  commitBusyLabel="Sending"
  unsavedChanges={false}
  onCommit={rotate}
>
  {#snippet notice()}
    {#if writeFailure !== null}
      {@render refusal(writeFailure)}
    {/if}
  {/snippet}
  {#snippet fields()}
    <p class="text-sm">
      A new link is emailed and the old one stops working at once. Anyone in the meeting on the old link is removed from it.
    </p>
  {/snippet}
</ActionDialog>

<!-- Withdrawing a link. The invitation stays on the record, marked withdrawn. -->
<ActionDialog
  bind:open={revoking}
  kind="destructive"
  heading="Withdraw a Guest Link"
  subtitle={questionSubject}
  commitLabel="Withdraw the Link"
  commitBusyLabel="Withdrawing"
  unsavedChanges={false}
  onCommit={revoke}
>
  {#snippet notice()}
    {#if writeFailure !== null}
      {@render refusal(writeFailure)}
    {/if}
  {/snippet}
  {#snippet fields()}
    <p class="text-sm">
      The link stops working at once, and anyone in the meeting on it is removed. Invite them again to send a new link.
    </p>
  {/snippet}
</ActionDialog>
