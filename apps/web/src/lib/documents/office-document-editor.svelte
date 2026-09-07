<script lang="ts">
  /*
   * An office document, open in the browser editor the edit worker serves.
   *
   * THE FRAME IS LOADED THE WAY A HOST MUST LOAD IT. The editor page expects the session's access
   * token as a form POST into its own frame — never as a query parameter, which would put a bearer
   * token in every address bar, history entry and referrer the frame touches. So the launch is
   * asked for on mount, and once it answers, a hidden form carrying `access_token` and
   * `access_token_ttl` is submitted programmatically into the named frame. Nothing here draws the
   * document: the editor provides the entire editing surface, and this component's whole job is
   * the launch, the frame and the states around them.
   *
   * A launch that comes back `view` is a read-only seat: another member holds the document's
   * exclusive lock, and the editor opens on the document without the ability to change it. That
   * is stated once, above the frame, and never as a blocked screen — reading is never refused.
   */
  import { dev } from "$app/environment";
  import { onMount } from "svelte";
  import Badge from "@magna-carta/design-system/badge";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { MatterFile } from "$lib/file-manager/matter-file-api.ts";
  import { openEditSession, type EditSessionLaunch } from "./document-api.ts";
  import { loopStep } from "./document-loop-availability.ts";

  let { file }: { file: MatterFile } = $props();

  // One name for the frame and the form that posts into it. Minted once per instance, so two
  // editors on one page (two tabs' worth of documents, or a test) can never post into each other.
  const identity = $props.id();
  const frameName = `document-editor-${identity}`;
  const editorStep = loopStep("edit-in-browser");

  let launch = $state<EditSessionLaunch | null>(null);
  let launchFailure = $state<StatedFailure | null>(null);
  let launchForm = $state<HTMLFormElement | null>(null);

  const opening = $derived(launch === null && launchFailure === null);

  /** Ask for the session. Retry asks again for the same document. */
  async function open(): Promise<void> {
    launch = null;
    launchFailure = null;
    const result = await openEditSession(fetch, file.id);
    if (result.kind === "ok") {
      launch = result.value;
      return;
    }
    launchFailure = stated(
      result.failure,
      "The editing session did not open.",
      "Nothing answered when the editing session was opened.",
    );
  }

  onMount(() => {
    void open();
  });

  // The form exists only once a launch has answered, and it is submitted the moment it is in the
  // document: that is the one gesture that carries the token into the frame.
  $effect(() => {
    if (launch !== null && launchForm !== null) launchForm.submit();
  });
</script>

<div class="flex min-h-0 flex-1 flex-col">
  {#if launch !== null && launch.capability === "view"}
    <div class="flex items-center gap-8 border-b border-border-default px-12 py-4 text-sm">
      <Badge variant="neutral">Read-only</Badge>
      <span class="text-text-muted">Another member holds this document's exclusive lock.</span>
    </div>
  {/if}

  <LoadingRegion
    loading={opening}
    failed={launchFailure !== null}
    label="Opening the editing session"
    onRetry={open}
    class="flex min-h-0 flex-1 flex-col"
  >
    {#snippet failure()}
      {#if launchFailure !== null}
        <div class="p-24">
          <FailureNotice
            failure={launchFailure.failure}
            subject="The editing session"
            fallback={launchFailure.fallback}
            whenSilent={launchFailure.whenSilent}
            onRetry={open}
          />
        </div>
      {/if}
    {/snippet}

    {#if launch !== null}
      <form method="post" action={launch.editorUrl} target={frameName} hidden bind:this={launchForm}>
        <input type="hidden" name="access_token" value={launch.accessToken} />
        <input type="hidden" name="access_token_ttl" value={String(launch.accessTokenTtl)} />
      </form>
    {/if}
    <!-- Edge to edge, like the file manager's list: the header above and the canvas's own edges
         are the frame's only border. -->
    <iframe
      name={frameName}
      title="Editor for {file.name}"
      allow="clipboard-read; clipboard-write"
      class="min-h-0 w-full flex-1 border-0 bg-surface-raised"
    ></iframe>
  </LoadingRegion>

  {#if dev}
    <p class="px-12 py-4 text-xs text-text-muted">{editorStep.behaviour}</p>
  {/if}
</div>
