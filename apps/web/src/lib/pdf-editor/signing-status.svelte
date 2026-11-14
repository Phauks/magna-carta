<script lang="ts">
  /*
   * Where a sent signing request stands: who has signed, who is next, what happened and when, and
   * the two things a member can still do to it, remind and cancel. Mockup screen 9.
   *
   * The activity lines are the server's own, observed rather than reported, and are the same lines
   * the Certificate of Completion prints when the request is sealed.
   */
  import Bell from "@lucide/svelte/icons/bell";
  import Ban from "@lucide/svelte/icons/ban";
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { cancelSigningRequest, remindSigners, type SigningRequestDetail } from "./signing-api.ts";
  import { attributionLabel } from "./signing-draft.ts";

  let {
    request,
    onChanged,
    onStartAgain,
  }: {
    request: SigningRequestDetail;
    onChanged: (request: SigningRequestDetail) => void;
    onStartAgain: () => void;
  } = $props();

  let busy = $state<"reminding" | "cancelling" | null>(null);
  let failure = $state<StatedFailure | null>(null);
  let confirmingCancel = $state(false);
  let cancelReason = $state("");

  const STATUS_LABEL: Record<SigningRequestDetail["status"], string> = {
    draft: "Draft",
    sent: "Out for Signature",
    completed: "Everyone Has Signed",
    declined: "Declined",
    voided: "Cancelled",
    expired: "Expired",
  };

  const SIGNER_STATUS_LABEL: Record<SigningRequestDetail["signers"][number]["status"], string> = {
    waiting: "Not Yet Sent",
    notified: "Sent",
    opened: "Opened",
    signed: "Signed",
    declined: "Declined",
  };

  const EVENT_LABEL: Record<SigningRequestDetail["events"][number]["kind"], string> = {
    created: "started the request",
    sent: "sent the request",
    delivered: "was sent the request",
    viewed: "opened the document",
    "identity-verified": "entered the access code",
    consented: "agreed to sign electronically",
    signed: "signed",
    declined: "declined to sign",
    reassigned: "was replaced as a signer",
    reminded: "sent a reminder",
    voided: "cancelled the request",
    completed: "Everyone signed",
    sealed: "The signed copy was sealed with the firm's certificate",
  };

  const next = $derived(
    request.signers.find((signer) => signer.status === "notified" || signer.status === "opened") ?? null,
  );
  const headline = $derived(
    request.status === "sent" && next !== null ? `Waiting on ${next.name}` : STATUS_LABEL[request.status],
  );
  const whenOf = (signer: SigningRequestDetail["signers"][number]): string | null =>
    signer.signedAt ?? signer.declinedAt ?? signer.openedAt ?? signer.notifiedAt;
  const events = $derived(request.events.toReversed());

  function eventLine(event: SigningRequestDetail["events"][number]): string {
    const label = EVENT_LABEL[event.kind];
    const who = event.actor ?? "";
    const where = event.detail === null ? "" : ` (${event.detail})`;
    const from = event.observedIp === null ? "" : ` from ${event.observedIp}`;
    if (event.kind === "completed" || event.kind === "sealed") return label;
    return `${who} ${label}${where}${from}`.trim();
  }

  async function remind(): Promise<void> {
    busy = "reminding";
    failure = null;
    const outcome = await remindSigners(fetch, request.id);
    busy = null;
    if (outcome.kind === "ok") onChanged(outcome.value);
    else failure = stated(outcome.failure, "The reminder was not sent.");
  }

  async function cancel(): Promise<void> {
    busy = "cancelling";
    failure = null;
    const outcome = await cancelSigningRequest(fetch, request.id, cancelReason);
    busy = null;
    if (outcome.kind === "ok") {
      confirmingCancel = false;
      onChanged(outcome.value);
    } else {
      failure = stated(outcome.failure, "The request was not cancelled.");
    }
  }
</script>

<div class="mc-scrollbar flex min-h-0 flex-1 flex-col gap-24 overflow-auto p-24">
  <div class="flex flex-wrap items-center gap-12">
    <div class="flex min-w-0 flex-col gap-4">
      <h2 class="font-display text-xl">{headline}</h2>
      <p class="text-sm text-text-muted">{request.title}</p>
    </div>
    <span class="ms-auto flex gap-8">
      {#if request.status === "sent"}
        <Button variant="secondary" disabled={busy !== null || next === null} onclick={remind}>
          <Bell class="size-16" aria-hidden="true" />
          {busy === "reminding" ? "Sending" : "Send Reminder"}
        </Button>
        <Button variant="secondary" disabled={busy !== null} onclick={() => (confirmingCancel = true)}>
          <Ban class="size-16" aria-hidden="true" />
          Cancel Request
        </Button>
      {:else}
        <Button variant="secondary" onclick={onStartAgain}>Start a New Request</Button>
      {/if}
    </span>
  </div>

  {#if request.status === "completed" && request.sealedAt === null}
    <Alert.Root variant="info">
      <Alert.Title>Waiting to Be Sealed</Alert.Title>
      <Alert.Description>
        Everyone has signed. The signed copy and its certificate are filed once the seal is applied.
      </Alert.Description>
    </Alert.Root>
  {/if}

  {#if confirmingCancel}
    <Alert.Root variant="warning">
      <Alert.Title>Cancel This Request?</Alert.Title>
      <Alert.Description>
        Links already sent stop working. Signatures already given stay on the record, and nothing is deleted.
      </Alert.Description>
      <div class="flex flex-col gap-8">
        <LabelledField label="Reason" hint="Kept on the request's record">
          {#snippet children({ props })}
            <Input {...props} bind:value={cancelReason} maxlength={500} />
          {/snippet}
        </LabelledField>
        <span class="flex gap-8">
          <Button variant="destructive" size="sm" disabled={busy !== null} onclick={cancel}>
            {busy === "cancelling" ? "Cancelling" : "Cancel Request"}
          </Button>
          <Button variant="ghost" size="sm" onclick={() => (confirmingCancel = false)}>Keep It</Button>
        </span>
      </div>
    </Alert.Root>
  {/if}

  {#if failure !== null}
    <FailureNotice failure={failure.failure} subject="The signing request" fallback={failure.fallback} />
  {/if}

  <DataTable.Root class="w-full">
    <DataTable.Header>
      <DataTable.Row>
        <DataTable.Head>#</DataTable.Head>
        <DataTable.Head>Signer</DataTable.Head>
        <DataTable.Head>Proves Identity By</DataTable.Head>
        <DataTable.Head>Status</DataTable.Head>
        <DataTable.Head>When</DataTable.Head>
      </DataTable.Row>
    </DataTable.Header>
    <DataTable.Body>
      {#each request.signers as signer (signer.id)}
        {@const when = whenOf(signer)}
        <DataTable.Row>
          <DataTable.Cell class="tabular-nums">{signer.position}</DataTable.Cell>
          <DataTable.Cell>
            <span class="flex flex-col">
              <span>{signer.name}</span>
              {#if signer.attribution !== "firm-authenticated"}
                <span class="text-xs text-text-muted">{signer.email}</span>
              {/if}
            </span>
          </DataTable.Cell>
          <DataTable.Cell>{attributionLabel(signer.attribution)}</DataTable.Cell>
          <DataTable.Cell>
            <Badge variant={signer.status === "signed" ? "success" : signer.status === "declined" ? "danger" : "neutral"}>
              {SIGNER_STATUS_LABEL[signer.status]}
            </Badge>
          </DataTable.Cell>
          <DataTable.Cell class="tabular-nums text-text-muted">{when === null ? "" : formatInstant(when)}</DataTable.Cell>
        </DataTable.Row>
      {:else}
        <DataTable.Row>
          <DataTable.Cell colspan={5} class="text-text-muted">This request names no signers.</DataTable.Cell>
        </DataTable.Row>
      {/each}
    </DataTable.Body>
  </DataTable.Root>

  <section class="flex flex-col gap-8" aria-labelledby="signing-activity">
    <h3 id="signing-activity" class="text-sm font-semibold">Activity</h3>
    <DataTable.Root class="w-full">
      <DataTable.Header>
        <DataTable.Row>
          <DataTable.Head>When</DataTable.Head>
          <DataTable.Head>What Happened</DataTable.Head>
        </DataTable.Row>
      </DataTable.Header>
      <DataTable.Body>
        {#each events as event, index (index)}
          <DataTable.Row>
            <DataTable.Cell class="whitespace-nowrap tabular-nums text-text-muted">{formatInstant(event.at)}</DataTable.Cell>
            <DataTable.Cell>{eventLine(event)}</DataTable.Cell>
          </DataTable.Row>
        {:else}
          <DataTable.Row>
            <DataTable.Cell colspan={2} class="text-text-muted">Nothing has happened yet.</DataTable.Cell>
          </DataTable.Row>
        {/each}
      </DataTable.Body>
    </DataTable.Root>
  </section>

  <section class="flex flex-col gap-8" aria-labelledby="signing-request-facts">
    <h3 id="signing-request-facts" class="text-sm font-semibold">Request</h3>
    <dl class="grid grid-cols-2 gap-x-16 gap-y-8 text-sm">
      <dt class="text-text-muted">Document</dt>
      <dd class="font-mono text-xs">
        {request.documentHashSha256 === null ? "Not sent" : `SHA-256 ${request.documentHashSha256.slice(0, 4)}...${request.documentHashSha256.slice(-4)}`}
      </dd>
      <dt class="text-text-muted">Sent</dt>
      <dd>{request.sentAt === null ? "Not sent" : formatInstant(request.sentAt)}</dd>
      <dt class="text-text-muted">Expires</dt>
      <dd>{formatInstant(request.expiresAt)}</dd>
      <dt class="text-text-muted">Order</dt>
      <dd>{request.order === "in-order" ? "In Order" : "All at Once"}</dd>
      <dt class="text-text-muted">Reminders</dt>
      <dd>{request.remindEveryDays === null ? "None" : `Every ${request.remindEveryDays} days`}</dd>
      {#if request.voidedReason !== null}
        <dt class="text-text-muted">Cancelled Because</dt>
        <dd>{request.voidedReason}</dd>
      {/if}
    </dl>
  </section>
</div>
