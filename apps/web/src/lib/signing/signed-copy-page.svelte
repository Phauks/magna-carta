<script lang="ts">
  /*
   * What the link in the completion email opens: the signed copy and its Certificate of Completion,
   * for an outside signer to keep.
   *
   * THE LINK TRAVELS IN A HEADER, NOT AN ADDRESS, so each file is fetched as bytes and handed to the
   * browser to save, rather than linked: a plain link would need the token in its address, and from
   * there it would reach every request record it passes.
   *
   * A LINK THAT CANNOT BE USED SAYS WHY in the server's own words: expired, replaced, or the copy not
   * sealed yet.
   */
  import Download from "@lucide/svelte/icons/download";
  import Button from "@magna-carta/design-system/button";
  import { formatInstantDate } from "@magna-carta/design-system/formatters";
  import AuthPanel from "$lib/auth/auth-panel.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { saveToTarget } from "$lib/export/save-target.ts";
  import { readSignedCopy, readSignedCopyFile, type SignedCopyView } from "./signer-api.ts";

  let { token }: { token: string } = $props();

  type Phase =
    | { readonly kind: "reading" }
    | { readonly kind: "closed"; readonly title: string; readonly sentence: string }
    | { readonly kind: "unread"; readonly failure: StatedFailure }
    | { readonly kind: "ready"; readonly view: SignedCopyView };

  let phase = $state<Phase>({ kind: "reading" });
  let saving = $state<"document" | "certificate" | null>(null);
  let saveFailure = $state<StatedFailure | null>(null);

  async function read(): Promise<void> {
    phase = { kind: "reading" };
    const outcome = await readSignedCopy(token);
    if (outcome.kind === "ok") {
      phase = { kind: "ready", view: outcome.value };
      return;
    }
    const problem = outcome.failure.problem;
    phase =
      problem !== null && problem !== undefined && [404, 410].includes(problem.status)
        ? {
            kind: "closed",
            title: problem.title ?? "This Link Doesn't Work",
            sentence: problem.detail ?? "Ask whoever sent you the document for a copy.",
          }
        : { kind: "unread", failure: stated(outcome.failure, "Couldn't open your signed copy.") };
  }

  async function save(view: SignedCopyView, which: "document" | "certificate"): Promise<void> {
    saving = which;
    saveFailure = null;
    const outcome = await readSignedCopyFile(token, which);
    saving = null;
    if (outcome.kind === "failed") {
      saveFailure = stated(outcome.failure, "Couldn't download the file.");
      return;
    }
    await saveToTarget(
      new Blob([outcome.value], { type: "application/pdf" }),
      which === "document" ? view.documentFileName : view.certificateFileName,
      "application/pdf",
    );
  }

  $effect(() => {
    void read();
  });
</script>

<svelte:head>
  <title>Your Signed Copy</title>
  <meta name="referrer" content="no-referrer" />
</svelte:head>

<div class="flex min-h-dvh items-center justify-center bg-surface-sunken p-16 sm:p-24">
  {#if phase.kind === "reading"}
    <AuthPanel title="Your Signed Copy">
      <p class="text-sm text-text-muted" role="status">Opening your signed copy</p>
    </AuthPanel>
  {:else if phase.kind === "closed"}
    <AuthPanel title={phase.title}>
      <p class="text-sm">{phase.sentence}</p>
    </AuthPanel>
  {:else if phase.kind === "unread"}
    <AuthPanel title="Your Signed Copy">
      <FailureNotice failure={phase.failure.failure} fallback={phase.failure.fallback} onRetry={() => void read()} />
    </AuthPanel>
  {:else}
    {@const view = phase.view}
    <AuthPanel title="Your Signed Copy">
      {#snippet meta()}
        {view.firmName === "" ? `Sent by ${view.senderName}` : `Sent by ${view.senderName} at ${view.firmName}`}
      {/snippet}
      <div class="flex flex-col gap-16">
        <div class="flex flex-col gap-4">
          <p class="text-base font-medium text-text-default">{view.title}</p>
          <p class="text-sm text-text-muted">Signed by everyone on {formatInstantDate(view.sealedAt, { length: "long" })}.</p>
        </div>
        <div class="flex flex-col gap-8">
          <Button variant="primary" disabled={saving !== null} onclick={() => void save(view, "document")}>
            <Download class="size-16" aria-hidden="true" />
            Download Signed Copy
          </Button>
          <Button variant="secondary" disabled={saving !== null} onclick={() => void save(view, "certificate")}>
            <Download class="size-16" aria-hidden="true" />
            Download Certificate of Completion
          </Button>
        </div>
        {#if saveFailure !== null}
          <FailureNotice failure={saveFailure.failure} fallback={saveFailure.fallback} />
        {/if}
        <p class="text-sm text-text-muted">Save both for your records. This link stops working 30 days after everyone signed.</p>
      </div>
    </AuthPanel>
  {/if}
</div>
