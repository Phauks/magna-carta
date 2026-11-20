<script lang="ts">
  /*
   * What the link in the completion email opens: the signed copy and its Certificate of Completion,
   * shown on the page to read at once, and each one downloadable to keep.
   *
   * THE LINK TRAVELS IN A HEADER, NOT AN ADDRESS, so each file is fetched as bytes: the same bytes
   * are drawn on the page by the firm's own engine (../documents/pdf-page-stack.svelte) and handed to
   * the browser to save, rather than linked, because a plain link would need the token in its
   * address, and from there it would reach every request record it passes.
   *
   * A LINK THAT CANNOT BE USED SAYS WHY in the server's own words: expired, replaced, or the copy not
   * sealed yet.
   */
  import Download from "@lucide/svelte/icons/download";
  import Button from "@magna-carta/design-system/button";
  import { formatInstantDate } from "@magna-carta/design-system/formatters";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import AuthPanel from "$lib/auth/auth-panel.svelte";
  import PdfPageStack from "$lib/documents/pdf-page-stack.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { saveToTarget } from "$lib/export/save-target.ts";
  import { readSignedCopy, readSignedCopyFile, type SignedCopyView } from "./signer-api.ts";

  let { token }: { token: string } = $props();

  type Which = "document" | "certificate";

  type Phase =
    | { readonly kind: "reading" }
    | { readonly kind: "closed"; readonly title: string; readonly sentence: string }
    | { readonly kind: "unread"; readonly failure: StatedFailure }
    | { readonly kind: "ready"; readonly view: SignedCopyView };

  type FileState =
    | { readonly kind: "loading" }
    | { readonly kind: "failed"; readonly failure: StatedFailure }
    | { readonly kind: "loaded"; readonly bytes: ArrayBuffer };

  const LABELS: Record<Which, string> = {
    document: "Signed Copy",
    certificate: "Certificate of Completion",
  };

  let phase = $state<Phase>({ kind: "reading" });
  let shown = $state<Which>("document");
  let files = $state<Record<Which, FileState>>({
    document: { kind: "loading" },
    certificate: { kind: "loading" },
  });

  async function load(which: Which): Promise<void> {
    files[which] = { kind: "loading" };
    const outcome = await readSignedCopyFile(token, which);
    files[which] =
      outcome.kind === "ok"
        ? { kind: "loaded", bytes: outcome.value }
        : { kind: "failed", failure: stated(outcome.failure, `Couldn't load the ${LABELS[which].toLowerCase()}.`) };
  }

  async function read(): Promise<void> {
    phase = { kind: "reading" };
    const outcome = await readSignedCopy(token);
    if (outcome.kind === "ok") {
      phase = { kind: "ready", view: outcome.value };
      void load("document");
      void load("certificate");
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

  async function save(view: SignedCopyView, which: Which): Promise<void> {
    const file = files[which];
    if (file.kind !== "loaded") return;
    await saveToTarget(
      new Blob([file.bytes], { type: "application/pdf" }),
      which === "document" ? view.documentFileName : view.certificateFileName,
      "application/pdf",
    );
  }

  $effect(() => {
    void read();
  });
</script>

<svelte:head>
  <title>{phase.kind === "ready" ? `Signed: ${phase.view.title}` : "Your Signed Copy"}</title>
  <meta name="referrer" content="no-referrer" />
</svelte:head>

{#if phase.kind === "ready"}
  {@const view = phase.view}
  {@const file = files[shown]}
  <div class="flex h-dvh min-h-0 flex-col bg-surface-sunken">
    <header class="flex min-h-64 flex-wrap items-center gap-x-16 gap-y-4 border-b border-border-default bg-surface-default px-16 py-8 sm:px-24">
      <span class="shrink-0 font-display text-xl text-text-default">{view.firmName}</span>
      <span class="min-w-0 truncate text-sm text-text-muted">{view.title} · sent by {view.senderName}</span>
    </header>
    <div class="flex flex-wrap items-center gap-x-16 gap-y-8 border-b border-border-default bg-surface-default px-16 py-8 sm:px-24">
      <Tabs.Root bind:value={shown}>
        <Tabs.List>
          <Tabs.Trigger value="document">{LABELS.document}</Tabs.Trigger>
          <Tabs.Trigger value="certificate">Certificate</Tabs.Trigger>
        </Tabs.List>
      </Tabs.Root>
      <span class="text-sm text-text-muted">Signed by everyone on {formatInstantDate(view.sealedAt, { length: "long" })}</span>
      <Button
        variant="primary"
        class="w-full sm:ms-auto sm:w-auto"
        disabled={file.kind !== "loaded"}
        onclick={() => void save(view, shown)}
      >
        <Download class="size-16" aria-hidden="true" />
        Download {shown === "document" ? LABELS.document : "Certificate"}
      </Button>
    </div>
    <main class="mc-scrollbar min-h-0 flex-1 overflow-auto p-16 sm:p-24">
      <div class="mx-auto flex max-w-4xl flex-col gap-16">
        <p class="text-center text-sm text-text-muted">Download both to keep them. This link stops working 30 days after everyone signed.</p>
        {#if file.kind === "loading"}
          <p class="text-center text-sm text-text-muted" role="status">Opening the {LABELS[shown].toLowerCase()}</p>
        {:else if file.kind === "failed"}
          <FailureNotice failure={file.failure.failure} fallback={file.failure.fallback} onRetry={() => void load(shown)} />
        {:else}
          {#key shown}
            <PdfPageStack bytes={file.bytes} label={LABELS[shown]} />
          {/key}
        {/if}
      </div>
    </main>
  </div>
{:else}
  <div class="flex min-h-dvh items-center justify-center bg-surface-sunken p-16 sm:p-24">
    {#if phase.kind === "reading"}
      <AuthPanel title="Your Signed Copy">
        <p class="text-sm text-text-muted" role="status">Opening your signed copy</p>
      </AuthPanel>
    {:else if phase.kind === "closed"}
      <AuthPanel title={phase.title}>
        <p class="text-sm">{phase.sentence}</p>
      </AuthPanel>
    {:else}
      <AuthPanel title="Your Signed Copy">
        <FailureNotice failure={phase.failure.failure} fallback={phase.failure.fallback} onRetry={() => void read()} />
      </AuthPanel>
    {/if}
  </div>
{/if}
