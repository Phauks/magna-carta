<script lang="ts">
  /*
   * The PDF Editor's Signature tab: send the document for signature and follow it until everyone
   * has signed.
   *
   * The tab shows the newest request on the file. A request still being prepared opens on its two
   * steps, fields and then review; one that has gone out opens on where it stands. The draft is kept
   * on the server only when the member saves it or sends it, and it is saved whole each time.
   *
   * The document that goes out is the file's current version as the server reads it at the moment of
   * sending, and its fingerprint is recorded then; nothing this screen holds is sent as the document.
   */
  import { onMount } from "svelte";
  import Save from "@lucide/svelte/icons/save";
  import Send from "@lucide/svelte/icons/send";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import type { PdfDocumentSource, PdfPageSize } from "$lib/documents/pdf-pages.ts";
  import type { MatterFile } from "$lib/file-manager/matter-file-api.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { openEditorDocument } from "./editor-document.ts";
  import {
    createSigningRequest,
    listSigningRequests,
    readSigningRequest,
    saveSigningDraft,
    sendSigningRequest,
    type SigningRequestDetail,
  } from "./signing-api.ts";
  import { dayAfter, draftFromDetail, draftRequest, type SigningDraft } from "./signing-draft.ts";
  import SigningFields from "./signing-fields.svelte";
  import SigningReview from "./signing-review.svelte";
  import SigningStatus from "./signing-status.svelte";

  let { file }: { file: MatterFile } = $props();

  /** How long a new request stays signable, and how often it reminds, unless the member changes it. */
  const DEFAULT_EXPIRY_DAYS = 30;
  const DEFAULT_REMIND_EVERY_DAYS = 3;

  type Phase =
    | { readonly kind: "opening" }
    | { readonly kind: "refused"; readonly message: string }
    | { readonly kind: "unread"; readonly failure: StatedFailure }
    | { readonly kind: "preparing" }
    | { readonly kind: "following"; readonly request: SigningRequestDetail };

  let phase = $state<Phase>({ kind: "opening" });
  let step = $state<"fields" | "review">("fields");
  let draft = $state<SigningDraft>(emptyDraft());
  let requestId = $state<string | null>(null);
  let busy = $state<"saving" | "sending" | null>(null);
  let saved = $state(false);
  let failure = $state<StatedFailure | null>(null);
  let source = $state<PdfDocumentSource | null>(null);
  let pages = $state<readonly PdfPageSize[]>([]);
  let gone = false;

  function emptyDraft(): SigningDraft {
    return {
      subject: `Please sign: ${file.name}`,
      message: "",
      order: "in-order",
      expiresOn: dayAfter(DEFAULT_EXPIRY_DAYS),
      remindEveryDays: DEFAULT_REMIND_EVERY_DAYS,
      signers: [],
      fields: [],
    };
  }

  async function open(): Promise<void> {
    const [opened, listed] = await Promise.all([
      openEditorDocument(
        file,
        "This document has a password. Unlock it in the File Workbench, save the unlocked copy, and send that for signature.",
      ),
      listSigningRequests(fetch, file.id),
    ]);
    if (gone) {
      if (opened.kind === "ready") opened.source.close();
      return;
    }
    if (opened.kind === "refused") {
      phase = { kind: "refused", message: opened.message };
      return;
    }
    source = opened.source;
    pages = opened.pages;
    if (listed.kind !== "ok") {
      phase = { kind: "unread", failure: stated(listed.failure, "Couldn't load the signing requests on this document.") };
      return;
    }
    const newest = listed.value.requests.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (newest === undefined) {
      phase = { kind: "preparing" };
      return;
    }
    const read = await readSigningRequest(fetch, newest.id);
    if (gone) return;
    if (read.kind !== "ok") {
      phase = { kind: "unread", failure: stated(read.failure, "Couldn't load the signing request.") };
      return;
    }
    show(read.value);
  }

  function show(request: SigningRequestDetail): void {
    if (request.status === "draft") {
      requestId = request.id;
      draft = draftFromDetail(request);
      phase = { kind: "preparing" };
    } else {
      phase = { kind: "following", request };
    }
  }

  onMount(() => {
    void open();
    return () => {
      gone = true;
      source?.close();
      source = null;
    };
  });

  /** Save the draft whole, making the request first if this is its first save. Null when it failed. */
  async function save(): Promise<string | null> {
    let id = requestId;
    if (id === null) {
      const created = await createSigningRequest(fetch, file.id);
      if (created.kind !== "ok") {
        failure = stated(created.failure, "Couldn't start the request.");
        return null;
      }
      id = created.value.id;
      requestId = id;
    }
    const written = await saveSigningDraft(fetch, id, draftRequest(draft));
    if (written.kind !== "ok") {
      failure = stated(written.failure, "The draft wasn't saved.");
      return null;
    }
    draft = draftFromDetail(written.value);
    return id;
  }

  async function saveDraft(): Promise<void> {
    busy = "saving";
    saved = false;
    failure = null;
    const id = await save();
    busy = null;
    saved = id !== null;
  }

  async function send(): Promise<void> {
    busy = "sending";
    saved = false;
    failure = null;
    const id = await save();
    if (id === null) {
      busy = null;
      return;
    }
    const sent = await sendSigningRequest(fetch, id);
    busy = null;
    if (sent.kind !== "ok") {
      failure = stated(sent.failure, "The request wasn't sent.");
      return;
    }
    show(sent.value);
  }

  function startAgain(): void {
    requestId = null;
    draft = emptyDraft();
    step = "fields";
    saved = false;
    failure = null;
    phase = { kind: "preparing" };
  }
</script>

{#if phase.kind === "opening"}
  <p class="p-24 text-sm text-text-muted" role="status">Reading the document</p>
{:else if phase.kind === "refused"}
  <div class="p-24">
    <Alert.Root variant="warning">
      <Alert.Title>This Document Can't Be Sent for Signature Here</Alert.Title>
      <Alert.Description>{phase.message}</Alert.Description>
    </Alert.Root>
  </div>
{:else if phase.kind === "unread"}
  <div class="p-24">
    <FailureNotice failure={phase.failure.failure} subject="The signing request" fallback={phase.failure.fallback} />
  </div>
{:else if phase.kind === "following"}
  <SigningStatus
    request={phase.request}
    onChanged={(request) => (phase = { kind: "following", request })}
    onStartAgain={startAgain}
  />
{:else if source !== null}
  <div class="flex min-h-0 flex-1 flex-col">
    {#if step === "fields"}
      <SigningFields bind:draft {source} {pages} />
    {:else}
      <SigningReview bind:draft disabled={busy !== null} />
    {/if}
    <div class="flex flex-none flex-wrap items-center gap-8 border-t border-border-default bg-surface-default px-16 py-12">
      <span class="text-sm text-text-muted">Step {step === "fields" ? 1 : 2} of 2: {step === "fields" ? "Signature Fields" : "Review and Send"}</span>
      {#if failure !== null}
        <div class="w-full">
          <FailureNotice failure={failure.failure} subject="The signing request" fallback={failure.fallback} />
        </div>
      {:else if saved}
        <Alert.Root variant="success" class="w-full">
          <Alert.Title>Draft Saved</Alert.Title>
          <Alert.Description>Nothing has been sent. Come back to it from this tab.</Alert.Description>
        </Alert.Root>
      {/if}
      <span class="ms-auto flex gap-8">
        <Button variant="ghost" disabled={busy !== null} onclick={saveDraft}>
          <Save class="size-16" aria-hidden="true" />
          {busy === "saving" ? "Saving" : "Save Draft"}
        </Button>
        {#if step === "fields"}
          <Button variant="primary" disabled={draft.signers.length === 0} onclick={() => (step = "review")}>Next: Review</Button>
        {:else}
          <Button variant="secondary" disabled={busy !== null} onclick={() => (step = "fields")}>Back to Fields</Button>
          <Button variant="primary" disabled={busy !== null || draft.signers.length === 0} onclick={send}>
            <Send class="size-16" aria-hidden="true" />
            {busy === "sending" ? "Sending" : "Send for Signature"}
          </Button>
        {/if}
      </span>
    </div>
  </div>
{/if}
