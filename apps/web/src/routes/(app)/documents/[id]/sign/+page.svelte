<script lang="ts">
  /*
   * A colleague signing a document inside the app. The same signing surface an outside signer reaches
   * by link, embedded under the matter's header: the signed-in session says who they are, so there is
   * no link and no access code, and the path names the document rather than the request.
   *
   * WHICH REQUEST. A document can be out for signature more than once; the server lists the requests
   * still waiting on this member, newest first, and the newest is the one signed here. When it is
   * done the next one, if any, is waiting on the same screen.
   */
  import { goto, invalidateAll } from "$app/navigation";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import FullHeightSection from "$lib/components/full-height-section.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { Failure } from "$lib/api/problem.ts";
  import { viewerHref } from "$lib/documents/editable-documents.ts";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { matterFilesBack } from "$lib/screen/screen-header.ts";
  import SignerPage from "$lib/signing/signer-page.svelte";
  import { listMySigningRequests, memberSession } from "$lib/signing/signer-api.ts";
  import type { DocumentViewPageData } from "../view/+page.ts";

  let { data }: { data: DocumentViewPageData } = $props();

  const file = $derived(data.file ?? null);
  const filesBack = $derived(
    file === null ? null : matterFilesBack(file.matterId, data.matter?.title ?? "Files", file.id),
  );

  type Waiting =
    | { readonly kind: "loading" }
    | { readonly kind: "failed"; readonly failure: Failure }
    | { readonly kind: "ready"; readonly requestIds: readonly string[] };

  let waiting = $state<Waiting>({ kind: "loading" });

  async function readWaiting(fileId: string): Promise<void> {
    waiting = { kind: "loading" };
    const outcome = await listMySigningRequests(fileId);
    waiting =
      outcome.kind === "ok"
        ? { kind: "ready", requestIds: outcome.value }
        : { kind: "failed", failure: outcome.failure };
  }

  $effect(() => {
    if (file !== null) void readWaiting(file.id);
  });

  const current = $derived(waiting.kind === "ready" ? (waiting.requestIds[0] ?? null) : null);
</script>

{#if data.failure !== undefined}
  <ScreenHeader title="Sign" class="mb-24" />
  <FailureNotice
    failure={data.failure}
    subject="The document"
    fallback="Couldn't load the document."
    whenSilent="Couldn't connect while reading the document."
    onRetry={() => void invalidateAll()}
  />
{:else if file !== null && filesBack !== null}
  <div class="flex min-h-full flex-col">
    <ScreenHeader title={`Sign ${file.name}`} back={filesBack} class="mb-24 flex-none" />
    <LoadingRegion
      loading={waiting.kind === "loading"}
      failed={waiting.kind === "failed"}
      empty={waiting.kind === "ready" && current === null}
      label="Looking for your signature requests"
      onRetry={() => void readWaiting(file.id)}
      class="flex min-h-0 flex-1 flex-col"
    >
      {#snippet failure()}
        {#if waiting.kind === "failed"}
          <FailureNotice
            failure={waiting.failure}
            subject="Your signature requests"
            fallback="Couldn't read what waits for your signature."
            whenSilent="Couldn't connect while reading what waits for your signature."
            onRetry={() => void readWaiting(file.id)}
          />
        {/if}
      {/snippet}
      {#snippet emptyState()}
        <EmptyState title="Nothing waits for your signature">
          This document has no request waiting on you. It may already be signed, or the request was
          withdrawn.
          {#snippet actions()}
            <Button variant="secondary" href={viewerHref(file.id)}>Open the Document</Button>
          {/snippet}
        </EmptyState>
      {/snippet}
      {#if current !== null}
        {#key current}
          <FullHeightSection class="-mx-24 flex flex-col border-t border-border-default">
            <SignerPage
              session={memberSession(current)}
              embedded
              onFinished={() => void goto(viewerHref(file.id))}
            />
          </FullHeightSection>
        {/key}
      {/if}
    </LoadingRegion>
  </div>
{/if}
